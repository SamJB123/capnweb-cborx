import {
  __experimental_newDurableObjectSessionStore,
  __experimental_newHibernatableWebSocketRpcSession,
  RpcTarget,
} from "capnweb";
import { DurableObject } from "cloudflare:workers";

interface Env {
  RPC_DO: DurableObjectNamespace<RpcDurableObject>;
}

// ---------------------------------------------------------------------------
// RPC targets
// ---------------------------------------------------------------------------

class CounterProxy extends RpcTarget {
  constructor(private ctx: DurableObjectState, private key: string) {
    super();
  }

  async increment(amount = 1) {
    const current = ((await this.ctx.storage.get(`counter:${this.key}`)) as number) ?? 0;
    const next = current + amount;
    await this.ctx.storage.put(`counter:${this.key}`, next);
    return next;
  }

  async getValue() {
    return ((await this.ctx.storage.get(`counter:${this.key}`)) as number) ?? 0;
  }
}

class Root extends RpcTarget {
  constructor(private ctx: DurableObjectState, private host: RpcDurableObject) {
    super();
  }

  square(n: number) { return n * n; }
  echo(msg: string) { return msg; }
  getInstanceId() { return this.host.instanceId; }

  getCounter(key: string) {
    return new CounterProxy(this.ctx, key);
  }
}

// ---------------------------------------------------------------------------
// Hibernation registry
// ---------------------------------------------------------------------------

class Registry {
  constructor(private ctx: DurableObjectState, private getHost: () => RpcDurableObject) {}

  describe(target: RpcTarget | Function) {
    if (target instanceof Root) {
      return { kind: "root" };
    }
    if (target instanceof CounterProxy) {
      return { kind: "counter", key: (target as any).key };
    }
    return undefined;
  }

  restore(descriptor: { kind: string; key?: string }) {
    if (descriptor?.kind === "root") {
      return new Root(this.ctx, this.getHost());
    }
    if (descriptor?.kind === "counter" && typeof descriptor.key === "string") {
      return new CounterProxy(this.ctx, descriptor.key);
    }
    throw new Error(`Unknown descriptor: ${JSON.stringify(descriptor)}`);
  }
}

// ---------------------------------------------------------------------------
// Durable Object
// ---------------------------------------------------------------------------

export class RpcDurableObject extends DurableObject {
  ctx: DurableObjectState;
  env: Env;
  registry: Registry;
  sessionStore: any;
  sessions = new Map<string, any>();
  ready: Promise<void>;
  instanceId = crypto.randomUUID();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.registry = new Registry(ctx, () => this);
    this.sessionStore = __experimental_newDurableObjectSessionStore(ctx.storage, "rpc:");
    this.ready = this._restoreSessions();
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/instance-id") {
      return Response.json({ instanceId: this.instanceId });
    }

    if (req.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, ["capnweb"]);
    await this.ready;
    await this._attachSession(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string) {
    await this.ready;
    const session = await this._getOrAttachSession(ws);
    session.handleMessage(message);
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
    await this.ready;
    const sid = (ws as any).deserializeAttachment()?.sessionId;
    this.sessions.get(sid)?.handleClose(code, reason, wasClean);
    if (sid) this.sessions.delete(sid);
  }

  async webSocketError(ws: WebSocket, error: unknown) {
    await this.ready;
    const sid = (ws as any).deserializeAttachment()?.sessionId;
    this.sessions.get(sid)?.handleError(error);
  }

  async _restoreSessions() {
    for (const ws of this.ctx.getWebSockets("capnweb")) {
      await this._attachSession(ws);
    }
  }

  async _getOrAttachSession(ws: WebSocket) {
    const sid = (ws as any).deserializeAttachment()?.sessionId;
    let session = sid ? this.sessions.get(sid) : undefined;
    if (!session) session = await this._attachSession(ws);
    return session;
  }

  async _attachSession(ws: WebSocket) {
    const session = await __experimental_newHibernatableWebSocketRpcSession(
      ws as any,
      new Root(this.ctx, this),
      { sessionStore: this.sessionStore, hibernationRegistry: this.registry },
    );
    this.sessions.set(session.sessionId, session);
    return session;
  }
}

// ---------------------------------------------------------------------------
// Worker entrypoint
// ---------------------------------------------------------------------------

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // WebSocket + instance-id go to the DO
    if (url.pathname === "/ws" || url.pathname === "/instance-id") {
      const id = env.RPC_DO.idFromName("test");
      const stub = env.RPC_DO.get(id);
      return stub.fetch(req);
    }

    // Everything else falls through to static assets
    return new Response("Not found", { status: 404 });
  },
};
