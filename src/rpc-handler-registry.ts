// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

/**
 * RpcHandlerRegistry - Generic storage for RpcStub handlers
 *
 * This utility enables the "capability-based subscription" pattern where:
 * 1. A client creates an RpcTarget with methods (e.g., onUpdate())
 * 2. The client passes the handler to a server
 * 3. The server stores the handler (with dup() to keep it alive)
 * 4. Later, the server calls methods on the handler via RPC
 *
 * The key insight is that capnweb's bidirectional RPC allows servers to call
 * client methods, not just the other way around. But handlers passed as RPC
 * parameters are disposed when the call completes - dup() creates a stable
 * reference that persists until explicitly disposed.
 *
 * @example
 * ```typescript
 * // Server-side: store handlers
 * const registry = new RpcHandlerRegistry<MyHandler>()
 *
 * subscribe(key: string, handler: RpcStub<MyHandler>) {
 *   registry.register(key, handler)  // Stores with dup()
 * }
 *
 * // Later: call handlers
 * async notify(key: string, data: SomeType) {
 *   const handler = registry.get(key)
 *   if (handler) {
 *     await handler.onUpdate(data)  // RPC to client!
 *   }
 * }
 * ```
 */

import type { RpcStub } from './index.js'
import type { RpcTarget } from './core.js'

/**
 * Generic registry for storing RpcStub handlers.
 *
 * Handles the dup()/dispose() lifecycle automatically:
 * - register() calls dup() to keep the handler alive
 * - unregister() calls Symbol.dispose on the handler
 * - dispose() cleans up all handlers
 *
 * @typeParam T - The RpcTarget interface that handlers implement
 */
export class RpcHandlerRegistry<T extends RpcTarget> {
	private handlers = new Map<string, RpcStub<T>>()

	/**
	 * Register a handler for a given key.
	 *
	 * IMPORTANT: This calls dup() on the handler to keep it alive.
	 * Without dup(), the handler would be disposed when the RPC call
	 * that passed it completes.
	 *
	 * If a handler already exists for this key, it is disposed and replaced.
	 *
	 * @param key - Unique identifier for this handler
	 * @param handler - The RpcStub to store (will be dup'd)
	 */
	register(key: string, handler: RpcStub<T>): void {
		// Dispose existing handler if any
		const existing = this.handlers.get(key)
		if (existing) {
			this.disposeHandler(existing)
		}

		// dup() creates a stable reference that persists after the RPC call ends
		const stableHandler = this.dupHandler(handler)
		this.handlers.set(key, stableHandler)
	}

	/**
	 * Unregister and dispose a handler.
	 *
	 * @param key - The key of the handler to remove
	 * @returns true if a handler was removed, false if none existed
	 */
	unregister(key: string): boolean {
		const handler = this.handlers.get(key)
		if (handler) {
			this.disposeHandler(handler)
			this.handlers.delete(key)
			return true
		}
		return false
	}

	/**
	 * Get a handler by key.
	 *
	 * @param key - The key to look up
	 * @returns The handler stub, or undefined if not found
	 */
	get(key: string): RpcStub<T> | undefined {
		return this.handlers.get(key)
	}

	/**
	 * Check if a handler exists for a key.
	 */
	has(key: string): boolean {
		return this.handlers.has(key)
	}

	/**
	 * Get all registered keys.
	 */
	keys(): IterableIterator<string> {
		return this.handlers.keys()
	}

	/**
	 * Get the number of registered handlers.
	 */
	get size(): number {
		return this.handlers.size
	}

	/**
	 * Dispose all handlers and clear the registry.
	 *
	 * Call this when the containing object is being destroyed
	 * (e.g., on connection close).
	 */
	dispose(): void {
		for (const handler of this.handlers.values()) {
			this.disposeHandler(handler)
		}
		this.handlers.clear()
	}

	/**
	 * Iterate over all handlers.
	 */
	forEach(callback: (handler: RpcStub<T>, key: string) => void): void {
		this.handlers.forEach((handler, key) => callback(handler, key))
	}

	/**
	 * Duplicate a handler to keep it alive.
	 * Handles the case where dup() might not exist.
	 */
	private dupHandler(handler: RpcStub<T>): RpcStub<T> {
		const anyHandler = handler as any
		if (typeof anyHandler.dup === 'function') {
			return anyHandler.dup() as RpcStub<T>
		}
		// If no dup(), return as-is (shouldn't happen with real RpcStubs)
		return handler
	}

	/**
	 * Dispose a handler safely.
	 */
	private disposeHandler(handler: RpcStub<T>): void {
		try {
			const anyHandler = handler as any
			if (typeof anyHandler[Symbol.dispose] === 'function') {
				anyHandler[Symbol.dispose]()
			}
		} catch (err) {
			// Log but don't throw - disposal errors shouldn't break the caller
			console.warn('[RpcHandlerRegistry] Error disposing handler:', err)
		}
	}
}
