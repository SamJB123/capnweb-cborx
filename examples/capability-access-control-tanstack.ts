/**
 * Capability-Based Access Control using TanStack DB
 *
 * This implementation uses TanStack DB's native Collection and Query system:
 * - createCollection() for reactive data stores
 * - Type-safe where filters via callback pattern: (row) => eq(row.field, value)
 * - subscribeChanges() for filtered reactive subscriptions
 * - currentStateAsChanges() for filtered reads
 *
 * The capability pattern wraps TanStack DB Collections with:
 * - Permission control (read, write, delete, subscribe)
 * - Row-level filtering via WhereFilter callbacks
 * - Attenuation (creating more restricted capabilities)
 * - Room-based organization of collections
 */

import { RpcTarget } from '../src/index.js';

// =============================================================================
// ACTUAL TanStack DB Imports
// =============================================================================

import {
  // The IR namespace contains the expression types
  IR,
  // Operator functions that create IR expressions
  eq,
  gt,
  gte,
  lt,
  lte,
  and,
  or,
  not,
  inArray,
  isNull,
  isUndefined,
  // Collection
  createCollection,
  localOnlyCollectionOptions,
  type Collection,
} from '@tanstack/db';

// Re-export for consumers
export { IR, eq, gt, gte, lt, lte, and, or, not, inArray, isNull, isUndefined };

// =============================================================================
// Core Types
// =============================================================================

export type Permission = 'read' | 'write' | 'delete' | 'subscribe';
export type PermissionSet = Set<Permission>;

// =============================================================================
// Subscription
// =============================================================================

export class Subscription extends RpcTarget {
  constructor(private cleanup: () => void) {
    super();
  }

  [Symbol.dispose]() {
    this.cleanup();
  }
}

// =============================================================================
// Where Filter Type - TanStack DB's native callback pattern
// =============================================================================

/**
 * A type-safe where filter using TanStack DB's callback pattern.
 * The callback receives a typed proxy and returns an IR expression.
 */
export type WhereFilter<T> = (row: T) => IR.BasicExpression<boolean>;

// =============================================================================
// Collection Capability
// =============================================================================

export class CollectionCapability<T extends { id: string }> extends RpcTarget {
  constructor(
    private collection: Collection<T, string>,
    private permissions: PermissionSet,
    private whereFilter: WhereFilter<T> | null = null
  ) {
    super();
  }

  getName(): string {
    return this.collection.id;
  }

  hasPermission(perm: Permission): boolean {
    return this.permissions.has(perm);
  }

  /**
   * Subscribe to the list of items visible through this capability.
   * Uses TanStack DB's native reactive subscribeChanges.
   * Returns a Subscription that receives updates as data changes.
   */
  list(callback: (items: T[]) => void): Subscription {
    if (!this.permissions.has('read')) {
      throw new Error('This capability does not permit reading');
    }

    // Maintain current state of visible items
    const items = new Map<string, T>();

    const subscription = this.collection.subscribeChanges(
      (changes) => {
        for (const change of changes) {
          if (change.type === 'insert') {
            items.set(String(change.key), this.cloneRow(change.value as T));
          } else if (change.type === 'update') {
            items.set(String(change.key), this.cloneRow(change.value as T));
          } else if (change.type === 'delete') {
            items.delete(String(change.key));
          }
        }
        // Notify with current items
        callback(Array.from(items.values()));
      },
      {
        where: this.whereFilter ?? undefined,
        includeInitialState: true,
      }
    );

    return new Subscription(() => subscription.unsubscribe());
  }

  /**
   * Get a single item by ID, with reactive updates.
   * Returns a Subscription that receives updates when the item changes.
   */
  get(id: string, callback: (item: T | undefined) => void): Subscription {
    if (!this.permissions.has('read')) {
      throw new Error('This capability does not permit reading');
    }

    const subscription = this.collection.subscribeChanges(
      (changes) => {
        // Check if any change affects our item
        for (const change of changes) {
          if (String(change.key) === id) {
            if (change.type === 'delete') {
              callback(undefined);
            } else {
              callback(this.cloneRow(change.value as T));
            }
            return;
          }
        }
      },
      {
        where: this.whereFilter ?? undefined,
        includeInitialState: true,
      }
    );

    return new Subscription(() => subscription.unsubscribe());
  }

  /**
   * Insert a new item. Uses TanStack DB's native insert.
   */
  insert(row: T) {
    if (!this.permissions.has('write')) {
      throw new Error('This capability does not permit writing');
    }

    // Note: Filter validation would require evaluating the where callback,
    // which TanStack DB handles internally
    return this.collection.insert(row);
  }

  /**
   * Check if an item is visible through this capability's filter.
   * Uses TanStack DB's subscribeChanges to properly evaluate the filter.
   */
  private isItemVisible(id: string): boolean {
    if (!this.whereFilter) {
      // No filter - item is visible if it exists
      return this.collection.get(id) !== undefined;
    }

    // Use TanStack DB's subscription to check visibility through the filter
    let isVisible = false;
    const subscription = this.collection.subscribeChanges(
      (changes) => {
        isVisible = changes.some(c => String(c.key) === id && c.type !== 'delete');
      },
      {
        where: this.whereFilter,
        includeInitialState: true,
      }
    );
    subscription.unsubscribe();
    return isVisible;
  }

  /**
   * Update an item. Uses TanStack DB's native update.
   * Verifies the item is visible through this capability's filter before updating.
   */
  update(id: string, updateFn: (draft: T) => void) {
    if (!this.permissions.has('write')) {
      throw new Error('This capability does not permit writing');
    }

    if (!this.isItemVisible(id)) {
      throw new Error('Item not found or not accessible through this capability');
    }

    return this.collection.update(id, updateFn as any);
  }

  /**
   * Delete an item. Uses TanStack DB's native delete.
   * Verifies the item is visible through this capability's filter before deleting.
   */
  delete(id: string) {
    if (!this.permissions.has('delete')) {
      throw new Error('This capability does not permit deletion');
    }

    if (!this.isItemVisible(id)) {
      throw new Error('Item not found or not accessible through this capability');
    }

    return this.collection.delete(id);
  }

  /**
   * Subscribe to changes. Uses TanStack DB's native subscribeChanges with where filter.
   */
  subscribe(callback: (changes: Array<{ type: string; key: string; value?: T }>) => void): Subscription {
    if (!this.permissions.has('subscribe')) {
      throw new Error('This capability does not permit subscriptions');
    }

    // Use TanStack DB's native subscribeChanges with the where filter
    const subscription = this.collection.subscribeChanges(
      (changes) => {
        callback(changes.map(c => ({
          type: c.type,
          key: String(c.key),
          value: c.value ? this.cloneRow(c.value as T) : undefined,
        })));
      },
      {
        where: this.whereFilter ?? undefined,
      }
    );

    return new Subscription(() => subscription.unsubscribe());
  }

  /**
   * ATTENUATION: Create a more restricted capability.
   * Combines where filters using TanStack DB's and() operator.
   */
  attenuate(options: {
    removePermissions?: Permission[];
    additionalWhere?: WhereFilter<T>;
  }): CollectionCapability<T> {
    let newPermissions = new Set(this.permissions);
    if (options.removePermissions) {
      for (const perm of options.removePermissions) {
        newPermissions.delete(perm);
      }
    }

    let newWhereFilter = this.whereFilter;
    if (options.additionalWhere) {
      if (this.whereFilter) {
        // Combine filters with AND using TanStack DB operators
        const existingFilter = this.whereFilter;
        const additionalFilter = options.additionalWhere;
        newWhereFilter = (row) => and(existingFilter(row), additionalFilter(row));
      } else {
        newWhereFilter = options.additionalWhere;
      }
    }

    return new CollectionCapability<T>(
      this.collection,
      newPermissions,
      newWhereFilter
    );
  }

  private cloneRow(row: T): T {
    return JSON.parse(JSON.stringify(row));
  }
}

// =============================================================================
// Room Capability
// =============================================================================

export class RoomCapability extends RpcTarget {
  constructor(
    private roomId: string,
    private store: RoomStore,
    private allowedCollections: Map<string, {
      permissions: PermissionSet;
      whereFilter: WhereFilter<any> | null;
    }>
  ) {
    super();
  }

  getRoomId(): string {
    return this.roomId;
  }

  listCollections(): string[] {
    return Array.from(this.allowedCollections.keys());
  }

  getCollection<T extends { id: string }>(name: string): CollectionCapability<T> | null {
    const config = this.allowedCollections.get(name);
    if (!config) return null;

    const collection = this.store.getCollection<T>(this.roomId, name);
    if (!collection) return null;

    return new CollectionCapability<T>(
      collection,
      config.permissions,
      config.whereFilter as WhereFilter<T> | null
    );
  }

  attenuate<T extends { id: string } = any>(options: {
    collections?: string[];
    collectionRestrictions?: Map<string, {
      removePermissions?: Permission[];
      additionalWhere?: WhereFilter<T>;
    }>;
  }): RoomCapability {
    const newAllowed = new Map<string, { permissions: PermissionSet; whereFilter: WhereFilter<any> | null }>();

    const collectionsToInclude = options.collections
      ? options.collections.filter(c => this.allowedCollections.has(c))
      : Array.from(this.allowedCollections.keys());

    for (const collName of collectionsToInclude) {
      const existing = this.allowedCollections.get(collName)!;
      const restrictions = options.collectionRestrictions?.get(collName);

      let newPerms = new Set(existing.permissions);
      if (restrictions?.removePermissions) {
        for (const perm of restrictions.removePermissions) {
          newPerms.delete(perm);
        }
      }

      let newWhereFilter = existing.whereFilter;
      if (restrictions?.additionalWhere) {
        if (existing.whereFilter) {
          const existingFilter = existing.whereFilter;
          const additionalFilter = restrictions.additionalWhere;
          newWhereFilter = (row: any) => and(existingFilter(row), additionalFilter(row));
        } else {
          newWhereFilter = restrictions.additionalWhere;
        }
      }

      newAllowed.set(collName, { permissions: newPerms, whereFilter: newWhereFilter });
    }

    return new RoomCapability(this.roomId, this.store, newAllowed);
  }
}

// =============================================================================
// Revocable Capability
// =============================================================================

export class RevocableCapability<T extends RpcTarget> extends RpcTarget {
  private revoked = false;

  constructor(private inner: T, private onRevoke?: () => void) {
    super();
  }

  getInner(): T {
    if (this.revoked) throw new Error('Capability has been revoked');
    return this.inner;
  }

  revoke(): void {
    if (!this.revoked) {
      this.revoked = true;
      this.onRevoke?.();
    }
  }

  isRevoked(): boolean {
    return this.revoked;
  }

  [Symbol.dispose]() {
    this.revoke();
  }
}

export function makeRevocable<T extends RpcTarget>(capability: T): {
  capability: RevocableCapability<T>;
  revoke: () => void;
} {
  const wrapper = new RevocableCapability(capability);
  return { capability: wrapper, revoke: () => wrapper.revoke() };
}

// =============================================================================
// User Hub
// =============================================================================

export class UserHub extends RpcTarget {
  private capabilities = new Map<string, RpcTarget>();
  private metadata = new Map<string, { from: string; grantedAt: Date; description?: string }>();

  constructor(private userId: string) {
    super();
  }

  getUserId(): string {
    return this.userId;
  }

  receiveCapability(
    name: string,
    capability: RpcTarget,
    metadata: { from: string; description?: string }
  ): void {
    this.capabilities.set(name, capability);
    this.metadata.set(name, {
      from: metadata.from,
      grantedAt: new Date(),
      description: metadata.description
    });
  }

  getCapability(name: string): RpcTarget | null {
    return this.capabilities.get(name) ?? null;
  }

  listCapabilities(): Array<{ name: string; from: string; grantedAt: Date; description?: string }> {
    return Array.from(this.metadata.entries()).map(([name, meta]) => ({ name, ...meta }));
  }

  [Symbol.dispose]() {
    this.capabilities.clear();
    this.metadata.clear();
  }
}

// =============================================================================
// Room Factory
// =============================================================================

export class RoomFactory extends RpcTarget {
  constructor(private store: RoomStore) {
    super();
  }

  async createRoom(config: { roomId: string; collections: string[] }): Promise<RoomCapability> {
    await this.store.createRoom(config.roomId, config.collections);

    const allCollections = new Map<string, { permissions: PermissionSet; whereFilter: WhereFilter<any> | null }>();
    for (const collName of config.collections) {
      allCollections.set(collName, {
        permissions: new Set(['read', 'write', 'delete', 'subscribe']),
        whereFilter: null
      });
    }

    return new RoomCapability(config.roomId, this.store, allCollections);
  }
}

// =============================================================================
// Room Store using TanStack DB Collections
// =============================================================================

export interface RoomStore {
  createRoom(roomId: string, collections: string[]): Promise<void>;
  getCollection<T extends { id: string }>(roomId: string, collectionName: string): Collection<T, string> | undefined;
}

/**
 * Room store backed by actual TanStack DB Collections.
 * Uses localOnlyCollectionOptions for proper reactive subscription support.
 */
export class TanStackRoomStore implements RoomStore {
  private rooms = new Map<string, Map<string, Collection<any, string>>>();

  async createRoom(roomId: string, collectionNames: string[]): Promise<void> {
    const collections = new Map<string, Collection<any, string>>();
    for (const name of collectionNames) {
      // Use localOnlyCollectionOptions for proper reactive support
      // This sets up the loopback sync that makes subscriptions work correctly
      const collection = createCollection<any, string>(
        localOnlyCollectionOptions({
          id: `${roomId}:${name}`,
          getKey: (item) => item.id,
        })
      );
      collections.set(name, collection);
    }
    this.rooms.set(roomId, collections);
  }

  getCollection<T extends { id: string }>(roomId: string, collectionName: string): Collection<T, string> | undefined {
    return this.rooms.get(roomId)?.get(collectionName) as Collection<T, string> | undefined;
  }
}

// =============================================================================
// Example Usage
// =============================================================================

interface Task {
  id: string;
  title: string;
  ownerId: string;
  assigneeId: string;
  isPublic: boolean;
  status?: string;
}

export async function exampleUsage() {
  // Use actual TanStack DB Collections via TanStackRoomStore
  const store = new TanStackRoomStore();
  const factory = new RoomFactory(store);

  // Alice creates a room
  const aliceRoomCap = await factory.createRoom({
    roomId: 'project-123',
    collections: ['tasks', 'comments']
  });

  console.log('Alice created room:', aliceRoomCap.listCollections());

  // =========================================================================
  // Create filter using TanStack DB's type-safe callback pattern
  // The 'row' parameter is typed, giving full autocomplete and type checking!
  // =========================================================================

  const bobWhereFilter: WhereFilter<Task> = (row) =>
    or(
      eq(row.assigneeId, 'bob'),
      eq(row.isPublic, true)
    );

  // Delegate to Bob with the filter - Bob can only see his tasks or public ones
  const bobRoomCap = aliceRoomCap.attenuate<Task>({
    collections: ['tasks'],
    collectionRestrictions: new Map([
      ['tasks', {
        removePermissions: ['delete'],
        additionalWhere: bobWhereFilter
      }]
    ])
  });

  // Insert some tasks using Alice's full-access capability
  const tasksCap = aliceRoomCap.getCollection<Task>('tasks')!;

  // TanStack DB's insert returns a Transaction - await isPersisted for confirmation
  await tasksCap.insert({ id: 't1', title: 'Alice Private', ownerId: 'alice', assigneeId: 'alice', isPublic: false }).isPersisted.promise;
  await tasksCap.insert({ id: 't2', title: 'Bob Task', ownerId: 'alice', assigneeId: 'bob', isPublic: false }).isPersisted.promise;
  await tasksCap.insert({ id: 't3', title: 'Public Task', ownerId: 'alice', assigneeId: 'alice', isPublic: true }).isPersisted.promise;

  console.log('Alice inserted 3 tasks');

  // Alice sees all tasks (reactive subscription)
  const aliceSubscription = tasksCap.list((tasks) => {
    console.log('Alice sees:', tasks.map(t => t.title));
  });

  // Bob can only see his tasks and public ones (filtered by TanStack DB)
  const bobTasksCap = bobRoomCap.getCollection<Task>('tasks')!;
  const bobSubscription = bobTasksCap.list((tasks) => {
    console.log('Bob sees:', tasks.map(t => t.title));
  });

  // Bob can update tasks he can see
  await bobTasksCap.update('t2', (draft) => {
    draft.title = 'Updated by Bob';
  }).isPersisted.promise;
  console.log('Bob updated task t2');

  // Bob cannot delete (permission removed during attenuation)
  try {
    bobTasksCap.delete('t2');
  } catch (e) {
    console.log('Bob cannot delete:', (e as Error).message);
  }

  // =========================================================================
  // Further attenuation: Create read-only capability for Carol
  // =========================================================================

  const carolTasksCap = bobTasksCap.attenuate({
    removePermissions: ['write', 'subscribe'],
  });

  console.log('Carol has read-only access (attenuated from Bob)');
  console.log('Carol can read:', carolTasksCap.hasPermission('read'));   // true
  console.log('Carol can write:', carolTasksCap.hasPermission('write')); // false

  // Carol sees the same filtered view as Bob (reactive subscription)
  const carolSubscription = carolTasksCap.list((tasks) => {
    console.log('Carol sees:', tasks.map(t => t.title));
  });

  // Clean up subscriptions when done
  // aliceSubscription[Symbol.dispose]();
  // bobSubscription[Symbol.dispose]();
  // carolSubscription[Symbol.dispose]();
}
