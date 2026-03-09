// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

/// <reference types="@cloudflare/workers-types" />

import { RpcStub } from "./core.js";
import { RpcTransport, RpcSession, RpcSessionOptions } from "./rpc.js";
import type {
  HibernatableSessionStore,
  HibernatableRpcTargetRegistry,
  HibernatableWebSocketAttachment,
} from "./hibernation.js";

export function newWebSocketRpcSession(
    webSocket: WebSocket | string, localMain?: any, options?: RpcSessionOptions): RpcStub {
  if (typeof webSocket === "string") {
    webSocket = new WebSocket(webSocket);
  }

  let transport = new WebSocketTransport(webSocket);
  let rpc = new RpcSession(transport, localMain, options);
  return rpc.getRemoteMain();
}

/**
 * For use in Cloudflare Workers: Construct an HTTP response that starts a WebSocket RPC session
 * with the given `localMain`.
 */
export function newWorkersWebSocketRpcResponse(
    request: Request, localMain?: any, options?: RpcSessionOptions): Response {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return new Response("This endpoint only accepts WebSocket requests.", { status: 400 });
  }

  let pair = new WebSocketPair();
  let server = pair[0];
  server.accept()
  newWebSocketRpcSession(server, localMain, options);
  return new Response(null, {
    status: 101,
    webSocket: pair[1],
  });
}

export type HibernatableWebSocketOptions = RpcSessionOptions & {
  sessionStore: HibernatableSessionStore;
  hibernationRegistry: HibernatableRpcTargetRegistry;
  sessionId?: string;
};

export interface HibernatableWebSocketSession {
  sessionId: string;
  getRemoteMain(): RpcStub;
  handleMessage(message: string | ArrayBuffer | ArrayBufferView): void;
  handleClose(code?: number, reason?: string, wasClean?: boolean): void;
  handleError(error: any): void;
}

type HibernatableWebSocket = WebSocket & {
  serializeAttachment?(value: unknown): void;
  deserializeAttachment?(): unknown;
};

export async function __experimental_newHibernatableWebSocketRpcSession(
    webSocket: HibernatableWebSocket,
    localMain: any,
    options: HibernatableWebSocketOptions): Promise<HibernatableWebSocketSession> {

  let sessionId = options.sessionId ?? getAttachedSessionId(webSocket);
  if (!sessionId) {
    sessionId = makeSessionId();
    webSocket.serializeAttachment?.({sessionId, version: 1 satisfies 1});
  }

  let snapshot = await options.sessionStore.load(sessionId);
  let rpc!: RpcSession;
  let persistScheduled = false;
  let transport = new HibernatableWebSocketTransport(webSocket, () => {
    if (!persistScheduled) {
      persistScheduled = true;
      queueMicrotask(() => {
        persistScheduled = false;
        void persistSnapshot();
      });
    }
  });

  rpc = new RpcSession(transport, localMain, {
    ...options,
    __experimental_hibernationRegistry: options.hibernationRegistry,
    __experimental_restoreSnapshot: snapshot,
  });

  await persistSnapshot();
  return {
    sessionId,
    getRemoteMain() {
      return rpc.getRemoteMain();
    },
    handleMessage(message: string | ArrayBuffer | ArrayBufferView) {
      transport.pushIncoming(message);
    },
    handleClose(code?: number, reason?: string, wasClean?: boolean) {
      transport.notifyClosed(code, reason, wasClean);
    },
    handleError(error: any) {
      transport.notifyError(error);
    },
  };

  async function persistSnapshot() {
    try {
      await options.sessionStore.save(sessionId!, rpc.__experimental_snapshot());
    } catch (err) {
      transport.abort?.(err);
    }
  }
}

export async function __experimental_resumeHibernatableWebSocketRpcSession(
    webSocket: HibernatableWebSocket,
    localMain: any,
    options: HibernatableWebSocketOptions): Promise<HibernatableWebSocketSession> {
  return __experimental_newHibernatableWebSocketRpcSession(webSocket, localMain, options);
}

function getAttachedSessionId(webSocket: HibernatableWebSocket): string | undefined {
  let attachment = webSocket.deserializeAttachment?.() as HibernatableWebSocketAttachment | null | undefined;
  if (attachment?.version === 1 && typeof attachment.sessionId === "string") {
    return attachment.sessionId;
  }

  return undefined;
}

function makeSessionId(): string {
  if ("crypto" in globalThis && typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `capnweb-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

class WebSocketTransport implements RpcTransport {
  constructor (webSocket: WebSocket, private onActivity?: () => void) {
    this.#webSocket = webSocket;

    // Ensure we receive ArrayBuffer instead of Blob for binary messages
    webSocket.binaryType = 'arraybuffer';

    if (webSocket.readyState === WebSocket.CONNECTING) {
      this.#sendQueue = [];
      webSocket.addEventListener("open", event => {
        try {
          for (let message of this.#sendQueue!) {
            webSocket.send(message);
          }
        } catch (err) {
          this.#receivedError(err);
        }
        this.#sendQueue = undefined;
      });
    }

    webSocket.addEventListener("message", (event: MessageEvent<any>) => {
      if (this.#error) {
        // Ignore further messages.
      } else {
        // Handle various binary message types:
        // - ArrayBuffer (browser standard)
        // - Uint8Array (both browser and Node)
        // - Buffer (Node.js ws module)
        // - ArrayBufferView (generic typed array)
        let message: Uint8Array | undefined;
        const data = event.data;

        if (data instanceof ArrayBuffer) {
          message = new Uint8Array(data);
        } else if (data instanceof Uint8Array) {
          message = data;
        } else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)) {
          // Node.js Buffer (from ws module)
          message = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        } else if (ArrayBuffer.isView(data)) {
          // Generic ArrayBufferView (TypedArray or DataView)
          message = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        }

        if (message) {
          if (this.#receiveResolver) {
            this.#receiveResolver(message);
            this.#receiveResolver = undefined;
            this.#receiveRejecter = undefined;
          } else {
            this.#receiveQueue.push(message);
          }
          this.onActivity?.();
        } else {
          this.#receivedError(new TypeError(`Received non-binary message from WebSocket: ${typeof data} ${Object.prototype.toString.call(data)}`));
        }
      }
    });

    webSocket.addEventListener("close", (event: CloseEvent) => {
      this.#receivedError(new Error(`Peer closed WebSocket: ${event.code} ${event.reason}`));
    });

    webSocket.addEventListener("error", (event: Event) => {
      this.#receivedError(new Error(`WebSocket connection failed.`));
    });
  }

  #webSocket: WebSocket;
  #sendQueue?: Uint8Array[];  // only if not opened yet
  #receiveResolver?: (message: Uint8Array) => void;
  #receiveRejecter?: (err: any) => void;
  #receiveQueue: Uint8Array[] = [];
  #error?: any;

  async send(message: Uint8Array): Promise<void> {
    if (this.#sendQueue === undefined) {
      this.#webSocket.send(message);
    } else {
      // Not open yet, queue for later.
      this.#sendQueue.push(message);
    }
    this.onActivity?.();
  }

  async receive(): Promise<Uint8Array> {
    if (this.#receiveQueue.length > 0) {
      return this.#receiveQueue.shift()!;
    } else if (this.#error) {
      throw this.#error;
    } else {
      return new Promise<Uint8Array>((resolve, reject) => {
        this.#receiveResolver = resolve;
        this.#receiveRejecter = reject;
      });
    }
  }

  abort?(reason: any): void {
    let message: string;
    if (reason instanceof Error) {
      message = reason.message;
    } else {
      message = `${reason}`;
    }
    this.#webSocket.close(3000, message);

    if (!this.#error) {
      this.#error = reason;
      // No need to call receiveRejecter(); RPC implementation will stop listening anyway.
    }
  }

  #receivedError(reason: any) {
    if (!this.#error) {
      this.#error = reason;
      if (this.#receiveRejecter) {
        this.#receiveRejecter(reason);
        this.#receiveResolver = undefined;
        this.#receiveRejecter = undefined;
      }
    }
  }
}

class HibernatableWebSocketTransport implements RpcTransport {
  constructor(
      private webSocket: WebSocket,
      private onActivity?: () => void) {}

  #receiveResolver?: (message: Uint8Array) => void;
  #receiveRejecter?: (err: any) => void;
  #receiveQueue: Uint8Array[] = [];
  #error?: any;

  async send(message: Uint8Array): Promise<void> {
    if (this.#error) throw this.#error;
    this.webSocket.send(message);
    this.onActivity?.();
  }

  async receive(): Promise<Uint8Array> {
    if (this.#receiveQueue.length > 0) {
      return this.#receiveQueue.shift()!;
    } else if (this.#error) {
      throw this.#error;
    } else {
      return new Promise<Uint8Array>((resolve, reject) => {
        this.#receiveResolver = resolve;
        this.#receiveRejecter = reject;
      });
    }
  }

  abort?(reason: any): void {
    let message: string;
    if (reason instanceof Error) {
      message = reason.message;
    } else {
      message = `${reason}`;
    }
    this.webSocket.close(3000, message);
    this.#setError(reason);
  }

  pushIncoming(message: string | ArrayBuffer | ArrayBufferView) {
    if (typeof message === "string") {
      this.#setError(new TypeError("Received non-binary message from hibernatable WebSocket."));
      return;
    }

    let bytes: Uint8Array;
    if (message instanceof ArrayBuffer) {
      bytes = new Uint8Array(message);
    } else {
      bytes = new Uint8Array(message.buffer, message.byteOffset, message.byteLength);
    }

    if (this.#receiveResolver) {
      this.#receiveResolver(bytes);
      this.#receiveResolver = undefined;
      this.#receiveRejecter = undefined;
    } else {
      this.#receiveQueue.push(bytes);
    }
    this.onActivity?.();
  }

  notifyClosed(code?: number, reason?: string, wasClean?: boolean) {
    const suffix = wasClean === undefined ? "" : ` clean=${wasClean}`;
    this.#setError(new Error(`Peer closed WebSocket: ${code ?? 1005} ${reason ?? ""}${suffix}`.trim()));
  }

  notifyError(error: any) {
    this.#setError(error instanceof Error ? error : new Error(`${error}`));
  }

  #setError(reason: any) {
    if (!this.#error) {
      this.#error = reason;
      if (this.#receiveRejecter) {
        this.#receiveRejecter(reason);
        this.#receiveResolver = undefined;
        this.#receiveRejecter = undefined;
      }
    }
  }
}
