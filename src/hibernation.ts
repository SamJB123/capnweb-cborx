// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import type { RpcTarget } from "./core.js";
import type { PropertyPath } from "./core.js";

/**
 * Describes a capability that can be rebound after the hosting process wakes from hibernation.
 *
 * The library treats the contents as application-defined. A common pattern is to encode a Durable
 * Object namespace plus object ID.
 */
export type HibernatableCapabilityDescriptor = {
  kind: string;
  [key: string]: unknown;
};

/**
 * Application-provided registry used to persist and rebind hibernatable exported capabilities.
 *
 * V1 support is intentionally narrow: only exported capabilities that can be described and later
 * recreated through this registry are resumable after hibernation.
 */
export interface HibernatableRpcTargetRegistry {
  describe(target: RpcTarget | Function): HibernatableCapabilityDescriptor | undefined;
  restore(descriptor: HibernatableCapabilityDescriptor): RpcTarget | Function;
}

export type RpcSessionSnapshotExport = {
  id: number;
  refcount: number;
  descriptor: HibernatableCapabilityDescriptor;
};

export type RpcSessionSnapshot = {
  version: 1;
  nextExportId: number;
  exports: RpcSessionSnapshotExport[];
  codec: {
    encodePaths: PropertyPath[];
    decodePaths: PropertyPath[];
    encodeStrings: string[];
    decodeStrings: string[];
  };
};

export interface HibernatableSessionStore {
  load(sessionId: string): Promise<RpcSessionSnapshot | undefined>;
  save(sessionId: string, snapshot: RpcSessionSnapshot): Promise<void>;
  delete?(sessionId: string): Promise<void>;
}

export type HibernatableWebSocketAttachment = {
  sessionId: string;
  version: 1;
};

export interface DurableObjectStorageLike {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  delete?(key: string): Promise<unknown>;
}

export function __experimental_newDurableObjectSessionStore(
    storage: DurableObjectStorageLike,
    prefix: string = "capnweb:session:"): HibernatableSessionStore {
  return {
    async load(sessionId: string) {
      const value = await storage.get(`${prefix}${sessionId}`);
      return value as RpcSessionSnapshot | undefined;
    },

    async save(sessionId: string, snapshot: RpcSessionSnapshot) {
      await storage.put(`${prefix}${sessionId}`, snapshot);
    },

    async delete(sessionId: string) {
      await storage.delete?.(`${prefix}${sessionId}`);
    },
  };
}
