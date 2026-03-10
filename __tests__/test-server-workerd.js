// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

// Test server implemented in workerd instead of Node.
//
// This is only used by the workerd tests, across a service binding.
//
// This file is JavaScript instead of TypeScript because otherwise we'd need to set up a separate
// build step for it. Instead, we're getting by configuring the worker in vitest.config.ts by
// just specifying the raw JS modules.

import {
  __experimental_newDurableObjectSessionStore,
  __experimental_newHibernatableWebSocketRpcSession,
  newWorkersRpcResponse,
  RpcTarget as JsRpcTarget,
} from "../dist/index-workers.js";
import { RpcTarget, DurableObject } from "cloudflare:workers";

// TODO(cleanup): At present we clone the implementation of Counter and TestTarget because
//   otherwise we need to set up a build step for `test-util.ts`.
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

  subscribe(callback) {
    this.subscriber = callback.dup();
  }

  async notify(value) {
    await this.subscriber(value);
    this.subscriber[Symbol.dispose]();
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
  constructor(env, host) {
    super();
    this.env = env;
    this.host = host;
  }

  getDurableCounter(name) {
    return new DurableCounterProxy(this.env, `hib-counter:${name}`);
  }

  square(i) {
    return i * i;
  }

  async delayedDurableIncrement(name, amount = 1, delayMs = 10) {
    await new Promise(resolve => setTimeout(resolve, delayMs));
    return this.getDurableCounter(name).increment(amount);
  }

  registerClientListener(name, listener) {
    this.host.registerClientListener(name, listener);
  }

  pushToClient(name, message) {
    return this.host.pushToClient(name, message);
  }

  getRegisteredClientCount() {
    return this.host.clientListeners.size;
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
    this.clientListeners = new Map();
    this.ready = this.restoreSessions();
  }

  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/control/restore" && req.method === "POST") {
      await this.forceHibernateAndRestore();
      return new Response("ok");
    }

    if (url.pathname.startsWith("/control/push/") && req.method === "POST") {
      const [, , , name, ...rest] = url.pathname.split("/");
      const message = decodeURIComponent(rest.join("/"));
      await this.pushToClient(name, message);
      return new Response("ok");
    }

    if (url.pathname === "/control/listener-count" && req.method === "GET") {
      return Response.json({ count: this.clientListeners.size });
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
    this.clientListeners.clear();
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
      new HibernationRootTarget(this.env, this),
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

  registerClientListener(name, listener) {
    this.clientListeners.set(name, listener);
  }

  async pushToClient(name, message) {
    const listener = this.clientListeners.get(name);
    if (!listener) return false;
    await listener.notify(message);
    return true;
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
    if (url.pathname.startsWith("/hibernate-push/") && req.method === "POST") {
      const controlPath = url.pathname.replace("/hibernate-push/", "/control/push/");
      return env.HIB_RPC.getByName("default").fetch(`http://foo${controlPath}`, { method: "POST" });
    }
    if (url.pathname === "/hibernate-listener-count" && req.method === "GET") {
      return env.HIB_RPC.getByName("default").fetch("http://foo/control/listener-count");
    }

    return newWorkersRpcResponse(req, new TestTarget(env), {
      onSendError(err) { return err; }
    });
  },

  async greet(name, env, ctx) {
    return `Hello, ${name}!`;
  }
}
