// Worker + Durable Object for hibernation testing.
//
// Uses ctx.acceptWebSocket() for real hibernatable WebSockets. workerd will
// evict the DO from memory when idle, and re-create it (running the
// constructor + webSocketMessage) when a message arrives on the WebSocket.

import {
  __experimental_newDurableObjectSessionStore,
  __experimental_newHibernatableWebSocketRpcSession,
  RpcTarget,
} from "capnweb";
import { DurableObject } from "cloudflare:workers";

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------

interface Env {
  HIB_RPC: DurableObjectNamespace<HibRpcDo>;
}

// ---------------------------------------------------------------------------
// RPC targets
// ---------------------------------------------------------------------------

class DurableCounterProxy extends RpcTarget {
  ctx: DurableObjectState;
  key: string;

  constructor(ctx: DurableObjectState, key: string) {
    super();
    this.ctx = ctx;
    this.key = key;
    console.log(`[TRACE] DurableCounterProxy created key=${key}`);
  }

  async increment(amount = 1) {
    console.log(`[TRACE] DurableCounterProxy.increment(${amount}) key=${this.key}`);
    try {
      const current = ((await this.ctx.storage.get(`counter:${this.key}`)) as number) ?? 0;
      const next = current + amount;
      await this.ctx.storage.put(`counter:${this.key}`, next);
      console.log(`[TRACE] DurableCounterProxy.increment done: ${current} -> ${next}`);
      return next;
    } catch (err) {
      console.error(`[TRACE] DurableCounterProxy.increment FAILED:`, err);
      throw err;
    }
  }

  get value() {
    console.log(`[TRACE] DurableCounterProxy.value getter called key=${this.key}`);
    return this.ctx.storage.get(`counter:${this.key}`).then((v) => {
      const result = (v as number) ?? 0;
      console.log(`[TRACE] DurableCounterProxy.value resolved: ${result}`);
      return result;
    });
  }
}

class RootTarget extends RpcTarget {
  ctx: DurableObjectState;
  host: HibRpcDo;

  constructor(ctx: DurableObjectState, host: HibRpcDo) {
    super();
    this.ctx = ctx;
    this.host = host;
    console.log(`[TRACE] RootTarget created`);
  }

  getDurableCounter(key: string) {
    console.log(`[TRACE] RootTarget.getDurableCounter(${key})`);
    return new DurableCounterProxy(this.ctx, key);
  }

  square(n: number) {
    console.log(`[TRACE] RootTarget.square(${n})`);
    return n * n;
  }

  echo(msg: string) {
    console.log(`[TRACE] RootTarget.echo(${msg})`);
    return msg;
  }

  getInstanceId() {
    console.log(`[TRACE] RootTarget.getInstanceId() -> ${this.host.instanceId}`);
    return this.host.instanceId;
  }

  async delayedDurableIncrement(name: string, amount = 1, delayMs = 10) {
    console.log(`[TRACE] RootTarget.delayedDurableIncrement(${name}, ${amount}, ${delayMs})`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return this.getDurableCounter(name).increment(amount);
  }
}

// ---------------------------------------------------------------------------
// Hibernation registry
// ---------------------------------------------------------------------------

class HibernationRegistry {
  ctx: DurableObjectState;

  constructor(ctx: DurableObjectState) {
    this.ctx = ctx;
  }

  describe(target: RpcTarget | Function) {
    console.log(`[TRACE] HibernationRegistry.describe() target=${target?.constructor?.name}`);
    if (target instanceof DurableCounterProxy) {
      return { kind: "durable-counter", key: target.key };
    }
    return undefined;
  }

  restore(descriptor: { kind: string; key?: string }) {
    console.log(`[TRACE] HibernationRegistry.restore()`, JSON.stringify(descriptor));
    if (descriptor?.kind !== "durable-counter" || typeof descriptor.key !== "string") {
      throw new Error(`Unknown hibernation descriptor: ${JSON.stringify(descriptor)}`);
    }
    return new DurableCounterProxy(this.ctx, descriptor.key);
  }
}

// ---------------------------------------------------------------------------
// Durable Object with real WebSocket hibernation
// ---------------------------------------------------------------------------

export class HibRpcDo extends DurableObject {
  ctx: DurableObjectState;
  env: Env;
  registry: HibernationRegistry;
  sessionStore: any;
  sessions: Map<string, any>;
  ready: Promise<void>;

  /** Random ID set once per instantiation. If it changes between calls,
   *  the DO was evicted and re-constructed (i.e. hibernation happened). */
  instanceId: string;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.instanceId = crypto.randomUUID();
    console.log(`[TRACE] HibRpcDo constructor (instance=${this.instanceId})`);

    // Test new Function to see if it's blocked
    try {
      new Function('');
      console.log(`[TRACE] new Function('') SUCCEEDED — code generation is ALLOWED`);
    } catch (e) {
      console.log(`[TRACE] new Function('') BLOCKED: ${e}`);
    }

    this.ctx = ctx;
    this.env = env;
    this.registry = new HibernationRegistry(ctx);
    this.sessionStore = __experimental_newDurableObjectSessionStore(ctx.storage, "hib:");
    this.sessions = new Map();
    this.ready = this._restoreSessions();
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    console.log(`[TRACE] HibRpcDo.fetch(${url.pathname})`);

    if (url.pathname === "/instance-id") {
      return Response.json({ instanceId: this.instanceId });
    }

    if (url.pathname === "/diagnostics") {
      let canGenCode = "unknown";
      try {
        new Function('');
        canGenCode = "YES — new Function('') succeeded";
      } catch (e: any) {
        canGenCode = `NO — ${e.constructor?.name}: ${e.message}`;
      }

      // Check cbor-x internals
      let cborxInfo = "unknown";
      try {
        const { Decoder } = await import("cbor-x");
        const d = new Decoder({ sequential: true, useRecords: true, structures: [] });
        cborxInfo = JSON.stringify({
          decoderType: typeof d,
          hasStructures: !!(d as any).structures,
        });
      } catch (e: any) {
        cborxInfo = `error: ${e.message}`;
      }

      return Response.json({
        instanceId: this.instanceId,
        canGenerateCode: canGenCode,
        cborxInfo,
      });
    }

    if (req.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server, ["capnweb"]);
    console.log(`[TRACE] accepted WebSocket, waiting for ready...`);
    await this.ready;
    console.log(`[TRACE] ready done, attaching session...`);
    await this._attachSession(server);
    console.log(`[TRACE] session attached, returning 101`);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string) {
    const msgType = typeof message === "string" ? "string" : `binary(${(message as ArrayBuffer).byteLength}b)`;
    console.log(`[TRACE] HibRpcDo.webSocketMessage(${msgType})`);
    try {
      await this.ready;
      const session = await this._getOrAttachSession(ws);
      console.log(`[TRACE] calling session.handleMessage...`);
      session.handleMessage(message);
      console.log(`[TRACE] session.handleMessage returned`);
    } catch (err) {
      console.error(`[TRACE] webSocketMessage FAILED:`, err);
      throw err;
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
    console.log(`[TRACE] HibRpcDo.webSocketClose(code=${code}, reason=${reason}, wasClean=${wasClean})`);
    await this.ready;
    const sid = this._getSessionId(ws);
    const session = sid ? this.sessions.get(sid) : undefined;
    session?.handleClose(code, reason, wasClean);
    if (sid) this.sessions.delete(sid);
  }

  async webSocketError(ws: WebSocket, error: unknown) {
    console.error(`[TRACE] HibRpcDo.webSocketError:`, error);
    await this.ready;
    const sid = this._getSessionId(ws);
    const session = sid ? this.sessions.get(sid) : undefined;
    session?.handleError(error);
  }

  async _restoreSessions() {
    const sockets = this.ctx.getWebSockets("capnweb");
    console.log(`[TRACE] _restoreSessions: ${sockets.length} hibernated sockets`);
    for (const ws of sockets) {
      try {
        console.log(`[TRACE] restoring socket, attachment:`, JSON.stringify((ws as any).deserializeAttachment?.()));
        await this._attachSession(ws);
        console.log(`[TRACE] socket restored successfully`);
      } catch (err) {
        console.error(`[TRACE] _restoreSessions: socket restore FAILED:`, err);
      }
    }
  }

  async _getOrAttachSession(ws: WebSocket) {
    const sid = this._getSessionId(ws);
    console.log(`[TRACE] _getOrAttachSession sid=${sid}, has session=${sid ? this.sessions.has(sid) : 'N/A'}`);
    let session = sid ? this.sessions.get(sid) : undefined;
    if (!session) {
      console.log(`[TRACE] no existing session, creating new one...`);
      session = await this._attachSession(ws);
    }
    return session;
  }

  async _attachSession(ws: WebSocket) {
    console.log(`[TRACE] _attachSession starting...`);
    try {
      const session = await __experimental_newHibernatableWebSocketRpcSession(
        ws as any,
        new RootTarget(this.ctx, this),
        {
          sessionStore: this.sessionStore,
          hibernationRegistry: this.registry,
        },
      );
      console.log(`[TRACE] _attachSession succeeded, sessionId=${session.sessionId}`);
      this.sessions.set(session.sessionId, session);
      return session;
    } catch (err) {
      console.error(`[TRACE] _attachSession FAILED:`, err);
      throw err;
    }
  }

  _getSessionId(ws: WebSocket): string | undefined {
    const attachment = (ws as any).deserializeAttachment();
    console.log(`[TRACE] _getSessionId: attachment=`, JSON.stringify(attachment));
    return attachment?.sessionId;
  }
}

// ---------------------------------------------------------------------------
// Worker entrypoint
// ---------------------------------------------------------------------------

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    console.log(`[TRACE] Worker fetch: ${new URL(req.url).pathname}`);
    const id = env.HIB_RPC.idFromName("test");
    const stub = env.HIB_RPC.get(id);
    return stub.fetch(req);
  },
};
