// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import { describe, expect, it } from "vitest";
import {
  RpcSession,
  RpcTarget,
  type RpcTransport,
  type HibernatableCapabilityDescriptor,
  type HibernatableRpcTargetRegistry,
} from "../src/index.js";

class SwitchingTransport implements RpcTransport {
  constructor(public name: string) {}

  private partner?: SwitchingTransport;
  private queue: Uint8Array[] = [];
  private waiter?: () => void;

  connect(partner: SwitchingTransport) {
    this.partner = partner;
    partner.partner = this;
  }

  async send(message: Uint8Array): Promise<void> {
    this.partner!.queue.push(message);
    if (this.partner!.waiter) {
      this.partner!.waiter();
      this.partner!.waiter = undefined;
    }
  }

  async receive(): Promise<Uint8Array> {
    if (this.queue.length === 0) {
      await new Promise<void>(resolve => {
        this.waiter = resolve;
      });
    }

    return this.queue.shift()!;
  }
}

class DurableCounter extends RpcTarget {
  constructor(
      readonly key: string,
      private store: Map<string, number>) {
    super();
  }

  increment(amount: number = 1) {
    const next = (this.store.get(this.key) ?? 0) + amount;
    this.store.set(this.key, next);
    return next;
  }

  get value() {
    return this.store.get(this.key) ?? 0;
  }
}

class TransientCounter extends RpcTarget {
  constructor(private value_: number = 0) {
    super();
  }

  increment(amount: number = 1) {
    this.value_ += amount;
    return this.value_;
  }
}

class CounterRegistry implements HibernatableRpcTargetRegistry {
  constructor(private store: Map<string, number>) {}

  describe(target: RpcTarget | Function): HibernatableCapabilityDescriptor | undefined {
    if (target instanceof DurableCounter) {
      return {
        kind: "durable-counter",
        key: target.key,
      };
    }

    return undefined;
  }

  restore(descriptor: HibernatableCapabilityDescriptor): RpcTarget | Function {
    if (descriptor.kind !== "durable-counter" || typeof descriptor.key !== "string") {
      throw new Error(`Unknown durable counter descriptor: ${JSON.stringify(descriptor)}`);
    }

    return new DurableCounter(descriptor.key, this.store);
  }
}

class RootTarget extends RpcTarget {
  constructor(private store: Map<string, number>) {
    super();
  }

  getDurableCounter(key: string, initialValue: number = 0) {
    if (!this.store.has(key)) {
      this.store.set(key, initialValue);
    }

    return new DurableCounter(key, this.store);
  }

  getTransientCounter(initialValue: number = 0) {
    return new TransientCounter(initialValue);
  }
}

describe("hibernation snapshots", () => {
  it("restores a resumable session and allows durable capabilities to be reacquired after wake", async () => {
    const state = new Map<string, number>();
    const registry = new CounterRegistry(state);
    const clientTransport = new SwitchingTransport("client");
    const serverTransport1 = new SwitchingTransport("server-1");
    clientTransport.connect(serverTransport1);

    const client = new RpcSession<RootTarget>(clientTransport);
    const server1 = new RpcSession(serverTransport1, new RootTarget(state), {
      __experimental_hibernationRegistry: registry,
    });

    const main = client.getRemoteMain();
    const counter = await main.getDurableCounter("alpha", 2);
    expect(await counter.increment(3)).toBe(5);

    const snapshot = server1.__experimental_snapshot();
    expect(snapshot.exports).toContainEqual({
      id: -1,
      refcount: 1,
      descriptor: {
        kind: "durable-counter",
        key: "alpha",
      },
    });

    const clientTransport2 = new SwitchingTransport("client-2");
    const serverTransport2 = new SwitchingTransport("server-2");
    clientTransport2.connect(serverTransport2);

    new RpcSession(serverTransport2, new RootTarget(state), {
      __experimental_hibernationRegistry: registry,
      __experimental_restoreSnapshot: snapshot,
    });

    const resumedClient = new RpcSession<RootTarget>(clientTransport2);
    const restoredCounter = await resumedClient.getRemoteMain().getDurableCounter("alpha");
    expect(await restoredCounter.value).toBe(5);
    expect(await restoredCounter.increment(4)).toBe(9);
  });

  it("rejects snapshots containing non-registry-backed exports", async () => {
    const state = new Map<string, number>();
    const registry = new CounterRegistry(state);
    const clientTransport = new SwitchingTransport("client");
    const serverTransport = new SwitchingTransport("server");
    clientTransport.connect(serverTransport);

    const client = new RpcSession<RootTarget>(clientTransport);
    const server = new RpcSession(serverTransport, new RootTarget(state), {
      __experimental_hibernationRegistry: registry,
    });

    const transient = await client.getRemoteMain().getTransientCounter(1);
    expect(await transient.increment(2)).toBe(3);

    expect(() => server.__experimental_snapshot()).toThrow(/not hibernatable/i);
  });
});
