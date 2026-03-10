import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { unstable_dev } from "wrangler";
import type { UnstableDevWorker } from "wrangler";
import { WebSocket } from "ws";

// capnweb client-side API (Node build)
import { newWebSocketRpcSession } from "../src/websocket.js";

// ---------------------------------------------------------------------------
// wrangler dev — starts a real worker + DO with hibernation
// ---------------------------------------------------------------------------

let worker: UnstableDevWorker;

beforeAll(async () => {
  worker = await unstable_dev("src/index.ts", {
    config: "wrangler.jsonc",
    experimental: { disableExperimentalWarning: true },
  });
});

afterAll(async () => {
  await worker?.stop();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function connectWebSocket(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`http://${worker.address}:${worker.port}/ws`, {
      headers: { Upgrade: "websocket" },
    });
    ws.binaryType = "arraybuffer";
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

/** Fetch the DO's in-memory instance ID via HTTP. Wakes the DO if hibernating. */
async function getInstanceId(): Promise<string> {
  const resp = await worker.fetch("/instance-id");
  const json = (await resp.json()) as { instanceId: string };
  return json.instanceId;
}

/**
 * Wait for the DO to hibernate. Does a single long sleep (15s — enough for
 * workerd's ~10s eviction timer), then fetches the instance ID once to check.
 * The fetch itself wakes the DO, so we only get one shot — no polling.
 *
 * @returns the new instance ID after hibernation.
 */
async function waitForHibernation(beforeId: string): Promise<string> {
  // Single sleep — no polling, so the DO gets uninterrupted idle time.
  await new Promise((r) => setTimeout(r, 15_000));

  const newId = await getInstanceId();
  if (newId === beforeId) {
    throw new Error(
      `DO did not hibernate after 15s (instanceId stayed ${beforeId})`,
    );
  }
  return newId;
}

/** Race a promise against a timeout. Avoids tests hanging forever. */
function withTimeout<T>(promise: Promise<T>, ms = 5000, label = "RPC call"): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

/** Generate a unique counter key so tests don't collide with prior runs. */
let keySeq = 0;
function uniqueKey(prefix: string): string {
  return `${prefix}-${Date.now()}-${keySeq++}`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("real hibernatable DO with capnweb RPC", () => {

  // =========================================================================
  // Basic connectivity
  // =========================================================================

  it("diagnostics: check new Function() in workerd", async () => {
    const resp = await worker.fetch("/diagnostics");
    const json = (await resp.json()) as any;
    console.log("DIAGNOSTICS:", JSON.stringify(json, null, 2));
    expect(json.canGenerateCode).toBeDefined();
  });

  it("basic RPC works through a real WebSocket + DO", async () => {
    const ws = await connectWebSocket();
    try {
      const root = newWebSocketRpcSession<any>(ws as any);
      expect(await root.square(7)).toBe(49);
      expect(await root.echo("hello")).toBe("hello");
    } finally {
      ws.close();
    }
  });

  it("durable counter works", async () => {
    const ws = await connectWebSocket();
    try {
      const root = newWebSocketRpcSession<any>(ws as any);
      const counter = await root.getDurableCounter(uniqueKey("basic"));
      expect(await counter.increment(10)).toBe(10);
      expect(await counter.increment(5)).toBe(15);
      expect(await counter.value).toBe(15);
    } finally {
      ws.close();
    }
  });

  // =========================================================================
  // Root stub survival
  // =========================================================================

  it("root stub keeps working after hibernation", async () => {
    const ws = await connectWebSocket();
    try {
      const root = newWebSocketRpcSession<any>(ws as any);
      expect(await root.square(3)).toBe(9);

      const idBefore = await root.getInstanceId();
      await waitForHibernation(idBefore);

      expect(await withTimeout(root.square(5))).toBe(25);
    } finally {
      ws.close();
    }
  });

  // =========================================================================
  // Child stub (durable capability) survival
  // =========================================================================

  it("child stub (durable counter) keeps working after hibernation", async () => {
    const ws = await connectWebSocket();
    try {
      const root = newWebSocketRpcSession<any>(ws as any);
      const key = uniqueKey("hib-child");
      const counter = await root.getDurableCounter(key);
      expect(await counter.increment(5)).toBe(5);

      const idBefore = await root.getInstanceId();
      await waitForHibernation(idBefore);

      expect(await withTimeout(counter.increment(3))).toBe(8);
    } finally {
      ws.close();
    }
  });

  // =========================================================================
  // Reacquire capability after hibernation
  // =========================================================================

  it("reacquire durable counter after hibernation", async () => {
    const ws = await connectWebSocket();
    try {
      const root = newWebSocketRpcSession<any>(ws as any);
      const key = uniqueKey("reacquire");
      const counter = await root.getDurableCounter(key);
      expect(await counter.increment(100)).toBe(100);

      const idBefore = await root.getInstanceId();
      await waitForHibernation(idBefore);

      const counter2 = await withTimeout(root.getDurableCounter(key));
      expect(await withTimeout(counter2.value)).toBe(100);
      expect(await withTimeout(counter2.increment(1))).toBe(101);
    } finally {
      ws.close();
    }
  });

  // =========================================================================
  // Multiple sessions
  // =========================================================================

  it("multiple sessions survive hibernation independently", async () => {
    const wsA = await connectWebSocket();
    const wsB = await connectWebSocket();
    try {
      const rootA = newWebSocketRpcSession<any>(wsA as any);
      const rootB = newWebSocketRpcSession<any>(wsB as any);

      expect(await rootA.square(2)).toBe(4);
      expect(await rootB.square(3)).toBe(9);

      const idBefore = await rootA.getInstanceId();
      await waitForHibernation(idBefore);

      expect(await withTimeout(rootA.square(4))).toBe(16);
      expect(await withTimeout(rootB.square(5))).toBe(25);
    } finally {
      wsA.close();
      wsB.close();
    }
  });

  // =========================================================================
  // In-flight call across hibernation
  // =========================================================================

  it("preserves an in-flight durable call across hibernation", async () => {
    const ws = await connectWebSocket();
    try {
      const root = newWebSocketRpcSession<any>(ws as any);

      // Warm up — make a call so the session is established and snapshotted.
      expect(await root.square(1)).toBe(1);

      const idBefore = await root.getInstanceId();
      await waitForHibernation(idBefore);

      // After hibernation, send a delayed call. The DO wakes, processes it,
      // and the delayed increment should succeed.
      expect(await withTimeout(
        root.delayedDurableIncrement(uniqueKey("inflight"), 7, 50),
      )).toBe(7);
    } finally {
      ws.close();
    }
  });

  // =========================================================================
  // Codec state survival
  // =========================================================================

  it("server can decode client messages after hibernation (codec structures preserved)", async () => {
    const ws = await connectWebSocket();
    try {
      const root = newWebSocketRpcSession<any>(ws as any);

      // Make many calls to build up diverse CBOR structure definitions
      // in the client's encoder (and mirrored in server's decoder).
      for (let i = 0; i < 10; i++) {
        try {
          const result = await root.square(i);
          console.log(`square(${i}) = ${result}`);
          expect(result).toBe(i * i);
        } catch (err: any) {
          console.error(`square(${i}) FAILED:`, err.message);
          throw err;
        }
      }
      const key = uniqueKey("codec");
      console.log("getting durable counter...");
      const c = await root.getDurableCounter(key);
      console.log("got durable counter");
      for (let i = 0; i < 5; i++) {
        try {
          const result = await c.increment(1);
          console.log(`increment(1) #${i} = ${result}`);
        } catch (err: any) {
          console.error(`increment(1) #${i} FAILED:`, err.message);
          throw err;
        }
      }

      const idBefore = await root.getInstanceId();
      await waitForHibernation(idBefore);

      expect(await withTimeout(root.square(42))).toBe(1764);
      const c2 = await withTimeout(root.getDurableCounter(key));
      expect(await withTimeout(c2.value)).toBe(5);
    } finally {
      ws.close();
    }
  });

  it("restored server can encode responses the client can decode", async () => {
    const ws = await connectWebSocket();
    try {
      const root = newWebSocketRpcSession<any>(ws as any);

      // Accumulate structures from both directions
      await root.echo("test-string-1");
      await root.echo("test-string-2");
      const key = uniqueKey("encode");
      const counter = await root.getDurableCounter(key);
      await counter.increment(50);

      const idBefore = await root.getInstanceId();
      await waitForHibernation(idBefore);

      expect(await withTimeout(root.echo("after-hibernation"))).toBe("after-hibernation");
      const c2 = await withTimeout(root.getDurableCounter(key));
      expect(await withTimeout(c2.value)).toBe(50);
    } finally {
      ws.close();
    }
  });

});
