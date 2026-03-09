// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import {
  __experimental_newDurableObjectSessionStore,
  __experimental_newHibernatableWebSocketRpcSession,
  newWorkersRpcResponse,
  RpcTarget as JsRpcTarget,
} from "../dist/index-workers.js";
import { RpcTarget, DurableObject } from "cloudflare:workers";

export class Counter extends RpcTarget {
  constructor(i) {
    super();
    this.i = i;
  }

  increment(amount = 1) {
    this.i += amount;
    return this.i;
  }
}

export class TestDo extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
  }

  increment(amount = 1) {
    this.value = (this.value ?? 0) + amount;
    return this.value;
  }

  setValue(val) {
    this.value = val;
  }

  getValue() {
    return this.value;
  }
}

export class TestTarget extends RpcTarget {
  constructor(env) {
    super();
    this.env = env;
  }

  square(i) {
    return i * i;
  }

  callSquare(self, i) {
    return { result: self.square(i) };
  }

  throwError() {
    throw new RangeError("test error");
  }

  makeCounter(i) {
    return new Counter(i);
  }

  incrementCounter(c, i = 1) {
    return c.increment(i);
  }

  getDurableObject(name) {
    return this.env.TEST_DO.getByName(name);
  }
}

class DurableCounterProxy extends JsRpcTarget {
  constructor(env, name) {
    super();
    this.env = env;
    this.name = name;
  }

  increment(amount = 1) {
    return this.env.TEST_DO.getByName(this.name).increment(amount);
  }

  get value() {
    return this.env.TEST_DO.getByName(this.name).getValue();
  }
}

class HibernationRootTarget extends JsRpcTarget {
  constructor(env) {
    super();
    this.env = env;
  }

  getDurableCounter(name) {
    return new DurableCounterProxy(this.env, `hib-counter:${name}`);
  }
}

class HibernationRegistry {
  constructor(env) {
    this.env = env;
  }

  describe(target) {
    if (target instanceof DurableCounterProxy) {
      return {
        kind: "test-do-counter",
        name: target.name,
      };
    }
  }

  restore(descriptor) {
    if (descriptor?.kind !== "test-do-counter" || typeof descriptor.name !== "string") {
      throw new Error(`Unknown hibernation descriptor: ${JSON.stringify(descriptor)}`);
    }

    return new DurableCounterProxy(this.env, descriptor.name);
  }
}

export class HibernationRpcDo extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.registry = new HibernationRegistry(env);
    this.sessionStore = __experimental_newDurableObjectSessionStore(ctx.storage, "hib:");
    this.sessions = new Map();
    this.ready = this.restoreSessions();
  }

  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/control/restore" && req.method === "POST") {
      await this.forceHibernateAndRestore();
      return new Response("ok");
    }

    if (req.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("This endpoint only accepts WebSocket requests.", { status: 400 });
    }

    const pair = new WebSocketPair();
    const server = pair[0];
    this.ctx.acceptWebSocket(server, ["capnweb"]);
    await this.ready;
    await this.attachSession(server);

    return new Response(null, {
      status: 101,
      webSocket: pair[1],
    });
  }

  async webSocketMessage(ws, message) {
    await this.ready;
    const session = await this.getOrAttachSession(ws);
    session.handleMessage(message);
  }

  async webSocketClose(ws, code, reason, wasClean) {
    await this.ready;
    const session = this.sessions.get(this.getSessionId(ws));
    session?.handleClose(code, reason, wasClean);
    this.sessions.delete(this.getSessionId(ws));
  }

  async webSocketError(ws, error) {
    await this.ready;
    const session = this.sessions.get(this.getSessionId(ws));
    session?.handleError(error);
  }

  async forceHibernateAndRestore() {
    this.sessions.clear();
    await this.restoreSessions();
  }

  async restoreSessions() {
    for (const ws of this.ctx.getWebSockets("capnweb")) {
      await this.attachSession(ws);
    }
  }

  async getOrAttachSession(ws) {
    const sessionId = this.getSessionId(ws);
    let session = sessionId ? this.sessions.get(sessionId) : undefined;
    if (!session) {
      session = await this.attachSession(ws);
    }
    return session;
  }

  async attachSession(ws) {
    const session = await __experimental_newHibernatableWebSocketRpcSession(
      ws,
      new HibernationRootTarget(this.env),
      {
        sessionStore: this.sessionStore,
        hibernationRegistry: this.registry,
      },
    );
    this.sessions.set(session.sessionId, session);
    return session;
  }

  getSessionId(ws) {
    return ws.deserializeAttachment()?.sessionId;
  }
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname === "/hibernate") {
      return env.HIB_RPC.getByName("default").fetch(req);
    }
    if (url.pathname === "/hibernate-force" && req.method === "POST") {
      await env.HIB_RPC.getByName("default").forceHibernateAndRestore();
      return new Response("ok");
    }

    return newWorkersRpcResponse(req, new TestTarget(env), {
      onSendError(err) { return err; }
    });
  },

  async greet(name, env, ctx) {
    return `Hello, ${name}!`;
  }
}
