/**
 * Capability-Based Access Control for capnweb
 *
 * This module provides patterns for implementing true capability-based security
 * using capnweb's RpcTarget system. The key insight is that an RpcTarget reference
 * IS the authorization - there's no identity checking or policy evaluation.
 *
 * Mental model: "Who gave you this capability?" not "Who are you?"
 */

import { RpcTarget, RpcStub } from '../src/index.js';

// =============================================================================
// SECTION 1: Core Capability Types
// =============================================================================

/**
 * Permission flags for collection operations
 */
export type Permission = 'read' | 'write' | 'delete' | 'subscribe';
export type PermissionSet = Set<Permission>;

// =============================================================================
// SECTION 1.5: Record-Replay Filter System (SECURE)
// =============================================================================
//
// This implements a secure filter mechanism inspired by capnweb's map() function.
// Instead of storing filter functions (which can close over mutable state),
// we record the filter's behavior once at delegation time and replay it.
//
// How it works:
// 1. Execute the filter function with a "recording proxy" that captures operations
// 2. Store the captured operations as immutable, serializable instructions
// 3. At filter evaluation time, replay the instructions against actual data
//
// This eliminates closure-based vulnerabilities because the filter function
// is only executed ONCE at delegation time - mutable closure state can't
// affect later executions.
//
// SECURITY: There is NO legacy function path. All filters MUST be recorded.
// =============================================================================

/**
 * Types of operations that can be recorded in a filter
 */
type FilterOp =
  | { type: 'get'; path: string[] }
  | { type: 'eq'; left: FilterValue; right: FilterValue }
  | { type: 'neq'; left: FilterValue; right: FilterValue }
  | { type: 'gt'; left: FilterValue; right: FilterValue }
  | { type: 'gte'; left: FilterValue; right: FilterValue }
  | { type: 'lt'; left: FilterValue; right: FilterValue }
  | { type: 'lte'; left: FilterValue; right: FilterValue }
  | { type: 'includes'; array: FilterValue; value: FilterValue }
  | { type: 'and'; left: FilterValue; right: FilterValue }
  | { type: 'or'; left: FilterValue; right: FilterValue }
  | { type: 'not'; value: FilterValue }
  | { type: 'literal'; value: unknown }
  | { type: 'truthy'; value: FilterValue };

type FilterValue = FilterOp | { type: 'ref'; idx: number };

/**
 * Result of recording a filter function
 */
interface RecordedFilterData {
  instructions: FilterOp[];
  resultIdx: number;
}

/**
 * Symbol to mark filter reference proxies
 */
const FILTER_REF = Symbol('filterRef');
const IS_FIELD_PROXY = Symbol('isFieldProxy');
const IS_RESULT_PROXY = Symbol('isResultProxy');

/**
 * Records operations performed during filter execution.
 *
 * WHY WE USE .is() INSTEAD OF ===:
 * JavaScript's === operator does NOT trigger Symbol.toPrimitive or any Proxy traps.
 * This means we cannot intercept `task.ownerId === 'bob'`.
 *
 * However, method calls like `task.ownerId.is('bob')` ARE intercepted by the Proxy.
 * So we use minimal helper methods:
 *   - .is(value) instead of ===
 *   - .or(other) instead of ||
 *   - .and(other) instead of &&
 *
 * This is NOT a DSL - just method chaining that we can actually intercept.
 */
class FilterRecorder {
  operations: FilterOp[] = [];

  /**
   * Create a recording proxy that captures property accesses and comparisons
   */
  createRecordingProxy<T>(): T {
    return this.createFieldProxy([]);
  }

  /**
   * Create a proxy for a field reference (e.g., task.ownerId)
   */
  createFieldProxy(path: string[]): any {
    const recorder = this;

    // Record the property access if we have a path
    let myIdx = -1;
    if (path.length > 0) {
      myIdx = this.operations.length;
      this.operations.push({ type: 'get', path: [...path] });
    }

    const handler: ProxyHandler<any> = {
      get: (target, prop) => {
        // Internal markers
        if (prop === FILTER_REF) return myIdx >= 0 ? myIdx : -1;
        if (prop === IS_FIELD_PROXY) return true;
        if (prop === IS_RESULT_PROXY) return false;

        // Handle symbols
        if (typeof prop === 'symbol') {
          if (prop === Symbol.toPrimitive) {
            // Return marker string (used when this proxy flows into .or()/.and())
            return () => `__FIELD_${myIdx >= 0 ? myIdx : 0}__`;
          }
          return undefined;
        }

        const propStr = String(prop);

        // ============= COMPARISON METHODS =============

        // .is(value) or .eq(value) - equality check
        if (propStr === 'is' || propStr === 'eq') {
          return (value: unknown) => {
            const fieldRef = myIdx >= 0 ? myIdx : recorder.addGetOp(path);
            const opIdx = recorder.operations.length;
            recorder.operations.push({
              type: 'eq',
              left: { type: 'ref', idx: fieldRef },
              right: recorder.captureValue(value)
            });
            return recorder.createResultProxy(opIdx);
          };
        }

        // .isNot(value) or .neq(value) - inequality check
        if (propStr === 'isNot' || propStr === 'neq') {
          return (value: unknown) => {
            const fieldRef = myIdx >= 0 ? myIdx : recorder.addGetOp(path);
            const opIdx = recorder.operations.length;
            recorder.operations.push({
              type: 'neq',
              left: { type: 'ref', idx: fieldRef },
              right: recorder.captureValue(value)
            });
            return recorder.createResultProxy(opIdx);
          };
        }

        // .isIn(array) - check if value is in array
        if (propStr === 'isIn' || propStr === 'in') {
          return (values: unknown[]) => {
            const fieldRef = myIdx >= 0 ? myIdx : recorder.addGetOp(path);
            const opIdx = recorder.operations.length;
            recorder.operations.push({
              type: 'includes',
              array: recorder.captureValue(values),
              value: { type: 'ref', idx: fieldRef }
            });
            return recorder.createResultProxy(opIdx);
          };
        }

        // .includes(value) - check if array field contains value
        if (propStr === 'includes') {
          return (value: unknown) => {
            const fieldRef = myIdx >= 0 ? myIdx : recorder.addGetOp(path);
            const opIdx = recorder.operations.length;
            recorder.operations.push({
              type: 'includes',
              array: { type: 'ref', idx: fieldRef },
              value: recorder.captureValue(value)
            });
            return recorder.createResultProxy(opIdx);
          };
        }

        // ============= BOOLEAN COMBINATION (on field = truthy check) =============

        // .or(other) - truthy OR other
        if (propStr === 'or') {
          return (other: any) => {
            // Convert this field to a truthy check first
            const fieldRef = myIdx >= 0 ? myIdx : recorder.addGetOp(path);
            const truthyIdx = recorder.operations.length;
            recorder.operations.push({ type: 'truthy', value: { type: 'ref', idx: fieldRef } });

            const otherIdx = recorder.resolveToResultIdx(other);
            const orIdx = recorder.operations.length;
            recorder.operations.push({
              type: 'or',
              left: { type: 'ref', idx: truthyIdx },
              right: { type: 'ref', idx: otherIdx }
            });
            return recorder.createResultProxy(orIdx);
          };
        }

        // .and(other) - truthy AND other
        if (propStr === 'and') {
          return (other: any) => {
            const fieldRef = myIdx >= 0 ? myIdx : recorder.addGetOp(path);
            const truthyIdx = recorder.operations.length;
            recorder.operations.push({ type: 'truthy', value: { type: 'ref', idx: fieldRef } });

            const otherIdx = recorder.resolveToResultIdx(other);
            const andIdx = recorder.operations.length;
            recorder.operations.push({
              type: 'and',
              left: { type: 'ref', idx: truthyIdx },
              right: { type: 'ref', idx: otherIdx }
            });
            return recorder.createResultProxy(andIdx);
          };
        }

        // ============= PROPERTY ACCESS =============
        // Return a new proxy for nested path (e.g., task.user.name)
        return recorder.createFieldProxy([...path, propStr]);
      }
    };

    return new Proxy({}, handler);
  }

  /**
   * Create a proxy for a result (e.g., the result of task.ownerId.is('bob'))
   */
  createResultProxy(opIdx: number): any {
    const recorder = this;

    const handler: ProxyHandler<any> = {
      get: (target, prop) => {
        // Internal markers
        if (prop === FILTER_REF) return opIdx;
        if (prop === IS_FIELD_PROXY) return false;
        if (prop === IS_RESULT_PROXY) return true;

        if (typeof prop === 'symbol') {
          if (prop === Symbol.toPrimitive) {
            return () => `__RESULT_${opIdx}__`;
          }
          return undefined;
        }

        const propStr = String(prop);

        // .or(other) - combine with OR
        if (propStr === 'or') {
          return (other: any) => {
            const otherIdx = recorder.resolveToResultIdx(other);
            const orOpIdx = recorder.operations.length;
            recorder.operations.push({
              type: 'or',
              left: { type: 'ref', idx: opIdx },
              right: { type: 'ref', idx: otherIdx }
            });
            return recorder.createResultProxy(orOpIdx);
          };
        }

        // .and(other) - combine with AND
        if (propStr === 'and') {
          return (other: any) => {
            const otherIdx = recorder.resolveToResultIdx(other);
            const andOpIdx = recorder.operations.length;
            recorder.operations.push({
              type: 'and',
              left: { type: 'ref', idx: opIdx },
              right: { type: 'ref', idx: otherIdx }
            });
            return recorder.createResultProxy(andOpIdx);
          };
        }

        // .not() - negate
        if (propStr === 'not') {
          return () => {
            const notOpIdx = recorder.operations.length;
            recorder.operations.push({
              type: 'not',
              value: { type: 'ref', idx: opIdx }
            });
            return recorder.createResultProxy(notOpIdx);
          };
        }

        return undefined;
      }
    };

    return new Proxy({}, handler);
  }

  /**
   * Add a get operation and return its index
   */
  private addGetOp(path: string[]): number {
    const idx = this.operations.length;
    this.operations.push({ type: 'get', path: [...path] });
    return idx;
  }

  /**
   * Resolve a value to a result index (for combining in .or()/.and())
   */
  private resolveToResultIdx(value: any): number {
    // If it's a result proxy, get its index
    if (value && typeof value === 'object') {
      if (value[IS_RESULT_PROXY]) {
        return value[FILTER_REF];
      }
      // If it's a field proxy, convert to truthy check
      if (value[IS_FIELD_PROXY]) {
        const fieldIdx = value[FILTER_REF];
        const truthyIdx = this.operations.length;
        if (fieldIdx >= 0) {
          this.operations.push({ type: 'truthy', value: { type: 'ref', idx: fieldIdx } });
        } else {
          // Root proxy - shouldn't happen but handle it
          this.operations.push({ type: 'literal', value: true });
        }
        return truthyIdx;
      }
    }
    // Literal boolean
    const litIdx = this.operations.length;
    this.operations.push({ type: 'literal', value: Boolean(value) });
    return litIdx;
  }

  /**
   * Capture a value (either a recorded reference or a literal)
   */
  captureValue(value: unknown): FilterValue {
    // Check if it's a filter reference proxy
    if (value && typeof value === 'object') {
      const ref = (value as any)[FILTER_REF];
      if (typeof ref === 'number' && ref >= 0) {
        return { type: 'ref', idx: ref };
      }
    }
    // Deep clone to capture the value at this moment
    return { type: 'literal', value: this.deepClone(value) };
  }

  private deepClone(value: unknown): unknown {
    if (value === null || value === undefined) return value;
    if (typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(v => this.deepClone(v));
    if (value instanceof Date) return new Date(value.getTime());
    const cloned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      cloned[k] = this.deepClone(v);
    }
    return cloned;
  }

  /**
   * Record the final result and return the recorded filter data
   */
  recordResult(result: unknown): RecordedFilterData {
    // If result is a result proxy, use its index
    if (result && typeof result === 'object' && (result as any)[IS_RESULT_PROXY]) {
      return { instructions: [...this.operations], resultIdx: (result as any)[FILTER_REF] };
    }

    // If result is a field proxy, convert to truthy check
    if (result && typeof result === 'object' && (result as any)[IS_FIELD_PROXY]) {
      const fieldIdx = (result as any)[FILTER_REF];
      if (fieldIdx >= 0) {
        const truthyIdx = this.operations.length;
        this.operations.push({ type: 'truthy', value: { type: 'ref', idx: fieldIdx } });
        return { instructions: [...this.operations], resultIdx: truthyIdx };
      }
    }

    // If result is a boolean literal, wrap it
    if (typeof result === 'boolean') {
      const opIdx = this.operations.length;
      this.operations.push({ type: 'literal', value: result });
      return { instructions: [...this.operations], resultIdx: opIdx };
    }

    // Treat as truthy/falsy
    const opIdx = this.operations.length;
    this.operations.push({ type: 'literal', value: Boolean(result) });
    return { instructions: [...this.operations], resultIdx: opIdx };
  }
}

/**
 * A filter that was recorded at delegation time and can be replayed.
 * This is immune to closure state mutation because it only stores
 * the instructions, not the original function.
 *
 * SECURITY: This is the ONLY way to create filters. No raw functions allowed.
 */
export class RecordedFilter<T = any> {
  private readonly frozenData: RecordedFilterData;

  constructor(data: RecordedFilterData) {
    // Deep clone and freeze the data to prevent any mutation
    this.frozenData = this.deepCloneAndFreeze(data);
  }

  private deepCloneAndFreeze(obj: any): any {
    if (obj === null || typeof obj !== 'object') return obj;

    if (Array.isArray(obj)) {
      const arr = obj.map(v => this.deepCloneAndFreeze(v));
      Object.freeze(arr);
      return arr;
    }

    const cloned: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      cloned[k] = this.deepCloneAndFreeze(v);
    }
    Object.freeze(cloned);
    return cloned;
  }

  /**
   * Evaluate the recorded filter against an actual row
   */
  evaluate(row: T): boolean {
    const results: unknown[] = [];

    for (const op of this.frozenData.instructions) {
      const result = this.evaluateOp(op, row, results);
      results.push(result);
    }

    return Boolean(results[this.frozenData.resultIdx]);
  }

  private evaluateOp(op: FilterOp, row: T, results: unknown[]): unknown {
    switch (op.type) {
      case 'get':
        return this.getPath(row, op.path);

      case 'literal':
        return op.value;

      case 'eq':
        return this.resolveValue(op.left, row, results) === this.resolveValue(op.right, row, results);

      case 'neq':
        return this.resolveValue(op.left, row, results) !== this.resolveValue(op.right, row, results);

      case 'gt':
        return (this.resolveValue(op.left, row, results) as any) > (this.resolveValue(op.right, row, results) as any);

      case 'gte':
        return (this.resolveValue(op.left, row, results) as any) >= (this.resolveValue(op.right, row, results) as any);

      case 'lt':
        return (this.resolveValue(op.left, row, results) as any) < (this.resolveValue(op.right, row, results) as any);

      case 'lte':
        return (this.resolveValue(op.left, row, results) as any) <= (this.resolveValue(op.right, row, results) as any);

      case 'includes': {
        const array = this.resolveValue(op.array, row, results);
        const value = this.resolveValue(op.value, row, results);
        return Array.isArray(array) && array.includes(value);
      }

      case 'and':
        return this.resolveValue(op.left, row, results) && this.resolveValue(op.right, row, results);

      case 'or':
        return this.resolveValue(op.left, row, results) || this.resolveValue(op.right, row, results);

      case 'not':
        return !this.resolveValue(op.value, row, results);

      case 'truthy':
        return Boolean(this.resolveValue(op.value, row, results));

      default:
        return false;
    }
  }

  private resolveValue(value: FilterValue, row: T, results: unknown[]): unknown {
    if (value.type === 'ref') {
      return results[value.idx];
    }
    return this.evaluateOp(value as FilterOp, row, results);
  }

  private getPath(obj: any, path: string[]): unknown {
    let current = obj;
    for (const prop of path) {
      if (current === null || current === undefined) return undefined;
      current = current[prop];
    }
    return current;
  }

  /**
   * Combine this filter with another using AND logic
   */
  and(other: RecordedFilter<T>): RecordedFilter<T> {
    const newInstructions: FilterOp[] = [...this.frozenData.instructions];
    const offset = newInstructions.length;

    // Add other's instructions with adjusted references
    for (const op of other.frozenData.instructions) {
      newInstructions.push(this.adjustRefs(op, offset));
    }

    // Add AND operation
    const andIdx = newInstructions.length;
    newInstructions.push({
      type: 'and',
      left: { type: 'ref', idx: this.frozenData.resultIdx },
      right: { type: 'ref', idx: other.frozenData.resultIdx + offset }
    });

    return new RecordedFilter({ instructions: newInstructions, resultIdx: andIdx });
  }

  private adjustRefs(op: FilterOp, offset: number): FilterOp {
    const adjustValue = (v: FilterValue): FilterValue => {
      if (v.type === 'ref') {
        return { type: 'ref', idx: v.idx + offset };
      }
      if ('left' in v || 'right' in v || 'value' in v || 'array' in v) {
        return this.adjustRefs(v as FilterOp, offset) as FilterValue;
      }
      return v;
    };

    switch (op.type) {
      case 'eq':
      case 'neq':
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte':
      case 'and':
      case 'or':
        return { ...op, left: adjustValue(op.left), right: adjustValue(op.right) };
      case 'includes':
        return { ...op, array: adjustValue(op.array), value: adjustValue(op.value) };
      case 'not':
      case 'truthy':
        return { ...op, value: adjustValue(op.value) };
      default:
        return op;
    }
  }
}

/**
 * Record a filter function's behavior and return a RecordedFilter.
 * The function is executed ONCE with a recording proxy, capturing
 * all operations. The result is immune to closure state changes.
 *
 * Usage:
 *   const filter = recordFilter<Task>(task => task.ownerId === 'bob');
 *   const attenuated = capability.attenuate({ additionalFilter: filter });
 */
export function recordFilter<T>(filterFn: (row: T) => unknown): RecordedFilter<T> {
  const recorder = new FilterRecorder();
  const proxy = recorder.createRecordingProxy<T>();

  // Execute the filter function ONCE to record its behavior
  const result = filterFn(proxy);

  // Capture the result
  const data = recorder.recordResult(result);

  return new RecordedFilter<T>(data);
}

/**
 * Update handler for subscriptions
 */
export interface UpdateHandler<T = any> extends RpcTarget {
  onInsert(row: T): void;
  onUpdate(oldRow: T, newRow: T): void;
  onDelete(row: T): void;
}

/**
 * Subscription handle - dispose to unsubscribe
 */
export class Subscription extends RpcTarget {
  constructor(private cleanup: () => void) {
    super();
  }

  [Symbol.dispose]() {
    this.cleanup();
  }
}

// =============================================================================
// SECTION 2: Collection Capability
// =============================================================================

/**
 * A capability granting access to a collection with specific permissions and filters.
 *
 * This is the core building block. The capability itself encodes:
 * - Which collection it accesses
 * - What operations are permitted
 * - What row filter applies (baked in at delegation time, not looked up from identity)
 *
 * IMPORTANT: The filter is NOT based on "current user" - it's baked into the capability
 * at delegation time. If Alice delegates a "see my tasks" capability to Bob, the filter
 * `row.ownerId === 'alice'` is encoded in the capability itself.
 *
 * SECURITY: Filters are RecordedFilters, not raw functions. This prevents closure
 * state mutation attacks. Use recordFilter() to create filters.
 */
export class CollectionCapability<T extends { id: string }> extends RpcTarget {
  constructor(
    private store: CollectionStore<T>,
    private collectionName: string,
    private permissions: PermissionSet,
    private filter: RecordedFilter<T> | null = null
  ) {
    super();
  }

  /**
   * Get the collection name (for debugging/logging)
   */
  getName(): string {
    return this.collectionName;
  }

  /**
   * Check if this capability has a specific permission
   */
  hasPermission(perm: Permission): boolean {
    return this.permissions.has(perm);
  }

  /**
   * Read all rows (applying this capability's filter)
   */
  async list(): Promise<T[]> {
    if (!this.permissions.has('read')) {
      throw new Error('This capability does not permit reading');
    }

    const allRows = await this.store.getAll(this.collectionName);
    return this.filter ? allRows.filter(row => this.filter!.evaluate(row)) : allRows;
  }

  /**
   * Get a single row by ID (if it passes the filter)
   */
  async get(id: string): Promise<T | null> {
    if (!this.permissions.has('read')) {
      throw new Error('This capability does not permit reading');
    }

    const row = await this.store.get(this.collectionName, id);
    if (!row) return null;
    if (this.filter && !this.filter.evaluate(row)) return null;
    return row;
  }

  /**
   * Insert a new row
   * Note: The filter may also restrict what can be written
   */
  async insert(row: T): Promise<T> {
    if (!this.permissions.has('write')) {
      throw new Error('This capability does not permit writing');
    }

    // If there's a filter, the inserted row must match it
    // (you can only insert rows you could also read)
    if (this.filter && !this.filter.evaluate(row)) {
      throw new Error('Cannot insert row that does not match capability filter');
    }

    return this.store.insert(this.collectionName, row);
  }

  /**
   * Update an existing row
   */
  async update(id: string, updates: Partial<T>): Promise<T> {
    if (!this.permissions.has('write')) {
      throw new Error('This capability does not permit writing');
    }

    const existing = await this.store.get(this.collectionName, id);
    if (!existing) {
      throw new Error('Row not found');
    }

    // Must be able to see the row to update it
    if (this.filter && !this.filter.evaluate(existing)) {
      throw new Error('Row not found'); // Don't reveal existence
    }

    const updated = { ...existing, ...updates };

    // Updated row must also match filter
    if (this.filter && !this.filter.evaluate(updated)) {
      throw new Error('Update would move row outside capability scope');
    }

    return this.store.update(this.collectionName, id, updated);
  }

  /**
   * Delete a row
   */
  async delete(id: string): Promise<void> {
    if (!this.permissions.has('delete')) {
      throw new Error('This capability does not permit deletion');
    }

    const existing = await this.store.get(this.collectionName, id);
    if (!existing) return;

    // Must be able to see the row to delete it
    if (this.filter && !this.filter.evaluate(existing)) {
      throw new Error('Row not found');
    }

    await this.store.delete(this.collectionName, id);
  }

  /**
   * Subscribe to changes (filtered by this capability's filter)
   *
   * The handler is an RpcTarget passed by the client - capnweb will
   * create a stub that the server can call back on.
   */
  async subscribe(handler: UpdateHandler<T>): Promise<Subscription> {
    if (!this.permissions.has('subscribe')) {
      throw new Error('This capability does not permit subscriptions');
    }

    // Capture the handler callbacks at subscription time to prevent mutation attacks
    const capturedOnInsert = handler.onInsert.bind(handler);
    const capturedOnUpdate = handler.onUpdate.bind(handler);
    const capturedOnDelete = handler.onDelete.bind(handler);

    const wrappedHandler: UpdateHandler<T> = {
      onInsert: (row: T) => {
        if (!this.filter || this.filter.evaluate(row)) {
          capturedOnInsert(row);
        }
      },
      onUpdate: (oldRow: T, newRow: T) => {
        const oldVisible = !this.filter || this.filter.evaluate(oldRow);
        const newVisible = !this.filter || this.filter.evaluate(newRow);

        if (oldVisible && newVisible) {
          capturedOnUpdate(oldRow, newRow);
        } else if (!oldVisible && newVisible) {
          capturedOnInsert(newRow);
        } else if (oldVisible && !newVisible) {
          capturedOnDelete(oldRow);
        }
        // If neither visible, no notification
      },
      onDelete: (row: T) => {
        if (!this.filter || this.filter.evaluate(row)) {
          capturedOnDelete(row);
        }
      }
    } as UpdateHandler<T>;

    const unsubscribe = this.store.subscribe(this.collectionName, wrappedHandler);
    return new Subscription(unsubscribe);
  }

  /**
   * ATTENUATION: Create a more restricted capability from this one.
   *
   * This is the key capability pattern - you can only give away
   * (subsets of) what you have. You can:
   * - Remove permissions (but not add them)
   * - Add additional filters (but not remove existing ones)
   *
   * SECURITY: Filters must be RecordedFilters created via recordFilter().
   * This prevents closure state mutation attacks.
   */
  attenuate(options: {
    removePermissions?: Permission[];
    additionalFilter?: RecordedFilter<T>;
  }): CollectionCapability<T> {
    // Start with current permissions
    let newPermissions = new Set(this.permissions);

    // Remove any specified permissions
    if (options.removePermissions) {
      for (const perm of options.removePermissions) {
        newPermissions.delete(perm);
      }
    }

    // Combine filters (AND logic - both must pass)
    let newFilter = this.filter;
    if (options.additionalFilter) {
      if (this.filter) {
        // Use the RecordedFilter's and() method to combine filters
        newFilter = this.filter.and(options.additionalFilter);
      } else {
        newFilter = options.additionalFilter;
      }
    }

    return new CollectionCapability<T>(
      this.store,
      this.collectionName,
      newPermissions,
      newFilter
    );
  }
}

// =============================================================================
// SECTION 3: Room Capability
// =============================================================================

/**
 * A capability granting access to a room, which may contain multiple collections.
 *
 * The room capability knows which collections it can access and with what restrictions.
 * When you get a collection from the room, you get a CollectionCapability.
 */
export class RoomCapability extends RpcTarget {
  constructor(
    private roomId: string,
    private store: RoomStore,
    private allowedCollections: Map<string, {
      permissions: PermissionSet;
      filter: RecordedFilter | null;
    }>
  ) {
    super();
  }

  getRoomId(): string {
    return this.roomId;
  }

  /**
   * List collections this capability can access
   */
  listCollections(): string[] {
    return Array.from(this.allowedCollections.keys());
  }

  /**
   * Get a capability for a specific collection
   */
  getCollection<T extends { id: string }>(name: string): CollectionCapability<T> | null {
    const config = this.allowedCollections.get(name);
    if (!config) {
      return null; // This capability doesn't grant access to this collection
    }

    const collectionStore = this.store.getCollectionStore<T>(this.roomId, name);
    return new CollectionCapability<T>(
      collectionStore,
      name,
      config.permissions,
      config.filter as RecordedFilter<T> | null
    );
  }

  /**
   * ATTENUATION: Create a restricted room capability
   *
   * SECURITY: Filters must be RecordedFilters created via recordFilter().
   * This prevents closure state mutation attacks.
   */
  attenuate(options: {
    collections?: string[];  // Subset of collections to allow
    collectionRestrictions?: Map<string, {
      removePermissions?: Permission[];
      additionalFilter?: RecordedFilter;
    }>;
  }): RoomCapability {
    const newAllowed = new Map<string, { permissions: PermissionSet; filter: RecordedFilter | null }>();

    // Filter to allowed collections
    const collectionsToInclude = options.collections
      ? options.collections.filter(c => this.allowedCollections.has(c))
      : Array.from(this.allowedCollections.keys());

    for (const collName of collectionsToInclude) {
      const existing = this.allowedCollections.get(collName)!;
      const restrictions = options.collectionRestrictions?.get(collName);

      // Copy and potentially restrict permissions
      let newPerms = new Set(existing.permissions);
      if (restrictions?.removePermissions) {
        for (const perm of restrictions.removePermissions) {
          newPerms.delete(perm);
        }
      }

      // Combine filters using RecordedFilter's and() method
      let newFilter = existing.filter;
      if (restrictions?.additionalFilter) {
        if (existing.filter) {
          newFilter = existing.filter.and(restrictions.additionalFilter);
        } else {
          newFilter = restrictions.additionalFilter;
        }
      }

      newAllowed.set(collName, { permissions: newPerms, filter: newFilter });
    }

    return new RoomCapability(this.roomId, this.store, newAllowed);
  }
}

// =============================================================================
// SECTION 4: Revocable Capability Wrapper
// =============================================================================

/**
 * Wraps any capability to make it revocable.
 *
 * This is the "caretaker" pattern from capability security.
 * The revoker can disable the capability at any time.
 */
export class RevocableCapability<T extends RpcTarget> extends RpcTarget {
  private revoked = false;

  constructor(
    private inner: T,
    private onRevoke?: () => void
  ) {
    super();
  }

  /**
   * Check if still valid before forwarding
   */
  private checkNotRevoked(): void {
    if (this.revoked) {
      throw new Error('Capability has been revoked');
    }
  }

  /**
   * Get the inner capability (if not revoked)
   */
  getInner(): T {
    this.checkNotRevoked();
    return this.inner;
  }

  /**
   * Revoke this capability
   */
  revoke(): void {
    if (!this.revoked) {
      this.revoked = true;
      this.onRevoke?.();
    }
  }

  /**
   * Check if revoked
   */
  isRevoked(): boolean {
    return this.revoked;
  }

  [Symbol.dispose]() {
    this.revoke();
  }
}

/**
 * Factory to create a revocable wrapper and its revoker
 */
export function makeRevocable<T extends RpcTarget>(capability: T): {
  capability: RevocableCapability<T>;
  revoke: () => void;
} {
  const wrapper = new RevocableCapability(capability);
  return {
    capability: wrapper,
    revoke: () => wrapper.revoke()
  };
}

// =============================================================================
// SECTION 5: User Hub as Capability Mailbox
// =============================================================================

/**
 * UserHub acts as a capability MAILBOX, not a policy enforcer.
 *
 * Key insight: The hub doesn't decide what you can access - it just stores
 * capabilities that others have delegated to you. The policy decision happened
 * at delegation time, by whoever delegated the capability.
 */
export class UserHub extends RpcTarget {
  private capabilities = new Map<string, RpcTarget>();
  private metadata = new Map<string, { from: string; grantedAt: Date; description?: string }>();

  constructor(private userId: string) {
    super();
  }

  getUserId(): string {
    return this.userId;
  }

  /**
   * Receive a capability that someone is delegating to this user.
   *
   * This is called by OTHER users/services when they want to give
   * this user a capability. The hub just stores it - no policy check.
   */
  receiveCapability(
    name: string,
    capability: RpcTarget,
    metadata: { from: string; description?: string }
  ): void {
    // Just store it - no identity check, no policy evaluation
    this.capabilities.set(name, capability);
    this.metadata.set(name, {
      from: metadata.from,
      grantedAt: new Date(),
      description: metadata.description
    });
  }

  /**
   * Get a capability by name
   */
  getCapability(name: string): RpcTarget | null {
    return this.capabilities.get(name) ?? null;
  }

  /**
   * List all capability names (for discovery UI)
   */
  listCapabilities(): Array<{
    name: string;
    from: string;
    grantedAt: Date;
    description?: string;
  }> {
    return Array.from(this.metadata.entries()).map(([name, meta]) => ({
      name,
      ...meta
    }));
  }

  /**
   * Remove a capability (user no longer wants it)
   */
  removeCapability(name: string): boolean {
    const had = this.capabilities.has(name);
    this.capabilities.delete(name);
    this.metadata.delete(name);
    return had;
  }

  [Symbol.dispose]() {
    // Dispose all held capabilities
    for (const cap of this.capabilities.values()) {
      if (Symbol.dispose in cap) {
        (cap as any)[Symbol.dispose]();
      }
    }
    this.capabilities.clear();
    this.metadata.clear();
  }
}

// =============================================================================
// SECTION 6: Capability Factory (Bootstrap / Genesis)
// =============================================================================

/**
 * Creates initial capabilities when resources are created.
 *
 * This is where capabilities come from originally:
 * 1. When a room is created, the creator gets the root capability
 * 2. The creator can then delegate (attenuated) capabilities to others
 */
export class RoomFactory extends RpcTarget {
  constructor(private store: RoomStore) {
    super();
  }

  /**
   * Create a new room and return the root (full-access) capability
   *
   * The caller becomes the "owner" - they have the only root capability
   * and can delegate to others.
   */
  async createRoom(config: {
    roomId: string;
    collections: string[];
  }): Promise<RoomCapability> {
    // Create the room in storage
    await this.store.createRoom(config.roomId, config.collections);

    // Build full-access configuration for all collections
    const allCollections = new Map<string, {
      permissions: PermissionSet;
      filter: RecordedFilter | null;
    }>();

    for (const collName of config.collections) {
      allCollections.set(collName, {
        permissions: new Set(['read', 'write', 'delete', 'subscribe']),
        filter: null  // No filter = full access
      });
    }

    // Return root capability to creator
    return new RoomCapability(config.roomId, this.store, allCollections);
  }
}

// =============================================================================
// SECTION 7: Cross-Room Capability Transfer
// =============================================================================

/**
 * Helper for transferring capabilities between rooms/services.
 *
 * Cross-room access is just delegation: someone who has capabilities to
 * both rooms explicitly delegates one to the other.
 *
 * SECURITY: Filter must be a RecordedFilter created via recordFilter().
 */
export async function setupCrossRoomSubscription(config: {
  sourceRoomCap: RoomCapability;
  sourceCollection: string;
  targetRoomCap: RoomCapability;
  targetCollection: string;
  filter?: RecordedFilter;
}): Promise<{
  subscription: Subscription;
  cleanup: () => void;
}> {
  // Get source collection capability, possibly attenuated
  let sourceCap = config.sourceRoomCap.getCollection(config.sourceCollection);
  if (!sourceCap) {
    throw new Error('No access to source collection');
  }

  if (config.filter) {
    sourceCap = sourceCap.attenuate({ additionalFilter: config.filter });
  }

  // Get target collection capability
  const targetCap = config.targetRoomCap.getCollection(config.targetCollection);
  if (!targetCap) {
    throw new Error('No access to target collection');
  }

  // Create handler that writes to target
  const handler = new CrossRoomSyncHandler(targetCap);

  // Subscribe source to push to target
  const subscription = await sourceCap.subscribe(handler);

  return {
    subscription,
    cleanup: () => {
      subscription[Symbol.dispose]();
    }
  };
}

class CrossRoomSyncHandler<T extends { id: string }> extends RpcTarget implements UpdateHandler<T> {
  constructor(private targetCap: CollectionCapability<T>) {
    super();
  }

  async onInsert(row: T): Promise<void> {
    try {
      await this.targetCap.insert(row);
    } catch (e) {
      // Log but don't fail the subscription
      console.error('Cross-room sync insert failed:', e);
    }
  }

  async onUpdate(_oldRow: T, newRow: T): Promise<void> {
    try {
      await this.targetCap.update(newRow.id, newRow);
    } catch (e) {
      console.error('Cross-room sync update failed:', e);
    }
  }

  async onDelete(row: T): Promise<void> {
    try {
      await this.targetCap.delete(row.id);
    } catch (e) {
      console.error('Cross-room sync delete failed:', e);
    }
  }
}

// =============================================================================
// SECTION 8: Storage Interfaces (Implement for your backend)
// =============================================================================

/**
 * Interface for collection-level storage operations
 */
export interface CollectionStore<T extends { id: string }> {
  getAll(collection: string): Promise<T[]>;
  get(collection: string, id: string): Promise<T | null>;
  insert(collection: string, row: T): Promise<T>;
  update(collection: string, id: string, row: T): Promise<T>;
  delete(collection: string, id: string): Promise<void>;
  subscribe(collection: string, handler: UpdateHandler<T>): () => void;
}

/**
 * Interface for room-level storage operations
 */
export interface RoomStore {
  createRoom(roomId: string, collections: string[]): Promise<void>;
  getCollectionStore<T extends { id: string }>(roomId: string, collection: string): CollectionStore<T>;
}

// =============================================================================
// SECTION 9: Example In-Memory Implementation (for testing)
// =============================================================================

/**
 * Simple in-memory store for testing/examples
 */
export class InMemoryStore implements RoomStore {
  private rooms = new Map<string, Map<string, Map<string, any>>>();
  private subscribers = new Map<string, Set<UpdateHandler<any>>>();

  async createRoom(roomId: string, collections: string[]): Promise<void> {
    const roomCollections = new Map<string, Map<string, any>>();
    for (const coll of collections) {
      roomCollections.set(coll, new Map());
    }
    this.rooms.set(roomId, roomCollections);
  }

  getCollectionStore<T extends { id: string }>(roomId: string, collection: string): CollectionStore<T> {
    return new InMemoryCollectionStore<T>(this, roomId, collection);
  }

  getData(roomId: string, collection: string): Map<string, any> | undefined {
    return this.rooms.get(roomId)?.get(collection);
  }

  getSubscribers(key: string): Set<UpdateHandler<any>> {
    if (!this.subscribers.has(key)) {
      this.subscribers.set(key, new Set());
    }
    return this.subscribers.get(key)!;
  }
}

class InMemoryCollectionStore<T extends { id: string }> implements CollectionStore<T> {
  constructor(
    private store: InMemoryStore,
    private roomId: string,
    private collection: string
  ) {}

  private getKey(): string {
    return `${this.roomId}:${this.collection}`;
  }

  private getData(): Map<string, T> {
    const data = this.store.getData(this.roomId, this.collection);
    if (!data) throw new Error('Collection not found');
    return data;
  }

  async getAll(): Promise<T[]> {
    return Array.from(this.getData().values());
  }

  async get(_collection: string, id: string): Promise<T | null> {
    return this.getData().get(id) ?? null;
  }

  async insert(_collection: string, row: T): Promise<T> {
    const data = this.getData();
    if (data.has(row.id)) {
      throw new Error('Row already exists');
    }
    data.set(row.id, row);

    // Notify subscribers
    for (const handler of this.store.getSubscribers(this.getKey())) {
      try { handler.onInsert(row); } catch (e) { /* ignore */ }
    }

    return row;
  }

  async update(_collection: string, id: string, row: T): Promise<T> {
    const data = this.getData();
    const old = data.get(id);
    if (!old) throw new Error('Row not found');

    data.set(id, row);

    // Notify subscribers
    for (const handler of this.store.getSubscribers(this.getKey())) {
      try { handler.onUpdate(old, row); } catch (e) { /* ignore */ }
    }

    return row;
  }

  async delete(_collection: string, id: string): Promise<void> {
    const data = this.getData();
    const old = data.get(id);
    if (!old) return;

    data.delete(id);

    // Notify subscribers
    for (const handler of this.store.getSubscribers(this.getKey())) {
      try { handler.onDelete(old); } catch (e) { /* ignore */ }
    }
  }

  subscribe(_collection: string, handler: UpdateHandler<T>): () => void {
    const subs = this.store.getSubscribers(this.getKey());
    subs.add(handler);
    return () => subs.delete(handler);
  }
}

// =============================================================================
// SECTION 10: Complete Usage Example
// =============================================================================

/**
 * Example demonstrating the full capability flow
 */
export async function exampleUsage() {
  // --- SETUP ---
  const store = new InMemoryStore();
  const factory = new RoomFactory(store);

  // --- CREATION: Alice creates a room ---
  const aliceRoomCap = await factory.createRoom({
    roomId: 'project-123',
    collections: ['tasks', 'comments', 'auditLogs']
  });

  console.log('Alice created room with full access to:', aliceRoomCap.listCollections());

  // --- DELEGATION: Alice invites Bob ---
  // Alice creates an attenuated capability for Bob:
  // - Can access tasks and comments, but NOT auditLogs
  // - Can only see tasks assigned to Bob
  // - Can read and write, but NOT delete
  //
  // SECURITY: Use recordFilter() to create filters. This records the filter's
  // behavior at delegation time, preventing closure state mutation attacks.

  const bobTaskFilter = recordFilter<Task>(task => task.assigneeId === 'bob' || task.isPublic);

  const bobRoomCap = aliceRoomCap.attenuate({
    collections: ['tasks', 'comments'],  // No auditLogs
    collectionRestrictions: new Map([
      ['tasks', {
        removePermissions: ['delete'],
        additionalFilter: bobTaskFilter
      }]
    ])
  });

  console.log('Bob can access:', bobRoomCap.listCollections());

  // --- BOB'S HUB: Deliver capability to Bob ---
  const bobHub = new UserHub('bob');
  bobHub.receiveCapability('project-123', bobRoomCap, {
    from: 'alice',
    description: 'Access to Project 123 (tasks and comments)'
  });

  console.log('Bob\'s capabilities:', bobHub.listCapabilities());

  // --- BOB USES HIS CAPABILITY ---
  const projectCap = bobHub.getCapability('project-123') as RoomCapability;
  const tasksCap = projectCap.getCollection<Task>('tasks')!;

  // Bob can insert a task (but only if it matches his filter)
  await tasksCap.insert({
    id: 'task-1',
    title: 'Bob\'s task',
    assigneeId: 'bob',
    isPublic: false
  });

  // Bob can list his tasks
  const bobsTasks = await tasksCap.list();
  console.log('Bob sees tasks:', bobsTasks);

  // Bob CANNOT access auditLogs
  const auditCap = projectCap.getCollection('auditLogs');
  console.log('Bob can access auditLogs?', auditCap !== null); // false

  // --- REVOCABLE CAPABILITY ---
  // Alice can give Bob a revocable capability
  const { capability: revocableCap, revoke } = makeRevocable(bobRoomCap);

  // Later, Alice revokes Bob's access
  revoke();

  try {
    revocableCap.getInner(); // throws "Capability has been revoked"
  } catch (e) {
    console.log('Revoked:', (e as Error).message);
  }

  // --- CROSS-ROOM ACCESS ---
  // Admin has access to both Project 123 and a Summary room
  const summaryRoomCap = await factory.createRoom({
    roomId: 'summary-room',
    collections: ['aggregatedTasks']
  });

  // Set up sync from project tasks to summary (admin has both capabilities)
  // SECURITY: Use recordFilter() to create the filter
  const completedTaskFilter = recordFilter<Task>(task => task.status === 'completed');

  const { subscription } = await setupCrossRoomSubscription({
    sourceRoomCap: aliceRoomCap,  // Alice has full access
    sourceCollection: 'tasks',
    targetRoomCap: summaryRoomCap,
    targetCollection: 'aggregatedTasks',
    filter: completedTaskFilter  // Only sync completed tasks
  });

  console.log('Cross-room subscription set up');

  // Cleanup
  subscription[Symbol.dispose]();
  bobHub[Symbol.dispose]();
}

// Type for the example
interface Task {
  id: string;
  title: string;
  assigneeId: string;
  isPublic: boolean;
  status?: string;
}
