/**
 * Tests for Capability-Based Access Control using TanStack DB
 *
 * These tests verify that the capability system properly uses TanStack DB's
 * native Collection and filtering features with reactive subscriptions.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  CollectionCapability,
  RoomCapability,
  RoomFactory,
  TanStackRoomStore,
  WhereFilter,
  Subscription,
  // These are re-exported from @tanstack/db
  IR,
  eq,
  gt,
  gte,
  lt,
  lte,
  and,
  or,
  not,
  inArray,
} from '../examples/capability-access-control-tanstack.js';

interface Task {
  id: string;
  title: string;
  ownerId: string;
  isPublic: boolean;
  status: 'pending' | 'active' | 'completed';
}

describe('Capability-Based Access Control (TanStack DB)', () => {
  let store: TanStackRoomStore;
  let factory: RoomFactory;
  let activeSubscriptions: Subscription[] = [];

  beforeEach(() => {
    store = new TanStackRoomStore();
    factory = new RoomFactory(store);
    activeSubscriptions = [];
  });

  afterEach(() => {
    // Clean up all subscriptions after each test
    for (const sub of activeSubscriptions) {
      sub[Symbol.dispose]();
    }
    activeSubscriptions = [];
  });

  describe('TanStack DB IR Types', () => {
    it('should create PropRef using IR.PropRef', () => {
      const ref = new IR.PropRef(['ownerId']);
      expect(ref.type).toBe('ref');
      expect(ref.path).toEqual(['ownerId']);
    });

    it('should create Value using IR.Value', () => {
      const val = new IR.Value('bob');
      expect(val.type).toBe('val');
      expect(val.value).toBe('bob');
    });

    it('should create Func using IR.Func', () => {
      const func = new IR.Func('eq', [
        new IR.PropRef(['ownerId']),
        new IR.Value('bob')
      ]);
      expect(func.type).toBe('func');
      expect(func.name).toBe('eq');
      expect(func.args).toHaveLength(2);
    });

    it('should use TanStack DB operator functions', () => {
      // These come from @tanstack/db
      const ref = new IR.PropRef(['ownerId']);
      const expression = eq(ref, 'bob');

      expect(expression.type).toBe('func');
      // Narrow the type using instanceof to access the name property
      expect(expression instanceof IR.Func).toBe(true);
      if (expression instanceof IR.Func) {
        expect(expression.name).toBe('eq');
      }
    });
  });

  describe('WhereFilter Callbacks', () => {
    it('should create type-safe filters using callbacks', async () => {
      const roomCap = await factory.createRoom({
        roomId: 'test',
        collections: ['tasks']
      });
      const tasksCap = roomCap.getCollection<Task>('tasks')!;

      // Type-safe filter - 'row' is typed as Task
      const bobFilter: WhereFilter<Task> = (row) =>
        or(eq(row.ownerId, 'bob'), eq(row.isPublic, true));

      // Insert tasks
      await tasksCap.insert({ id: '1', title: 'Alice Private', ownerId: 'alice', isPublic: false, status: 'pending' }).isPersisted.promise;
      await tasksCap.insert({ id: '2', title: 'Bob Task', ownerId: 'bob', isPublic: false, status: 'pending' }).isPersisted.promise;
      await tasksCap.insert({ id: '3', title: 'Public Task', ownerId: 'alice', isPublic: true, status: 'pending' }).isPersisted.promise;

      const bobCap = tasksCap.attenuate({ additionalWhere: bobFilter });

      // Subscribe and track state reactively
      let currentItems: Task[] = [];
      const subscription = bobCap.list((items) => {
        currentItems = items;
      });
      activeSubscriptions.push(subscription);

      // Allow time for subscription to process
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(currentItems).toHaveLength(2);
      expect(currentItems.map(t => t.id).sort()).toEqual(['2', '3']);
    });

    it('should support complex filters with AND/OR/NOT', async () => {
      const roomCap = await factory.createRoom({
        roomId: 'test',
        collections: ['tasks']
      });
      const tasksCap = roomCap.getCollection<Task>('tasks')!;

      await tasksCap.insert({ id: '1', title: 'T1', ownerId: 'bob', isPublic: false, status: 'pending' }).isPersisted.promise;
      await tasksCap.insert({ id: '2', title: 'T2', ownerId: 'bob', isPublic: true, status: 'completed' }).isPersisted.promise;
      await tasksCap.insert({ id: '3', title: 'T3', ownerId: 'alice', isPublic: true, status: 'pending' }).isPersisted.promise;
      await tasksCap.insert({ id: '4', title: 'T4', ownerId: 'alice', isPublic: false, status: 'pending' }).isPersisted.promise;

      // Complex filter: (bob OR public) AND (pending status)
      const filter: WhereFilter<Task> = (row) =>
        and(
          or(eq(row.ownerId, 'bob'), eq(row.isPublic, true)),
          eq(row.status, 'pending')
        );

      // Direct manual evaluation test for T4
      const T4 = { id: '4', title: 'T4', ownerId: 'alice', isPublic: false, status: 'pending' as const };

      // Test each sub-expression manually
      const ownerIsBob = T4.ownerId === 'bob';
      const isPublicTrue = T4.isPublic === true;
      const orResult = ownerIsBob || isPublicTrue;
      const statusPending = T4.status === 'pending';
      const finalResult = orResult && statusPending;

      console.log('=== Manual T4 evaluation ===');
      console.log('T4:', T4);
      console.log('ownerId === bob:', ownerIsBob);  // false
      console.log('isPublic === true:', isPublicTrue);  // false
      console.log('OR result:', orResult);  // false
      console.log('status === pending:', statusPending);  // true
      console.log('AND result (should be FALSE):', finalResult);  // false

      // Now test using TanStack operators directly with actual values
      const eqOwner = eq(new IR.Value(T4.ownerId), new IR.Value('bob'));
      const eqPublic = eq(new IR.Value(T4.isPublic), new IR.Value(true));
      const eqStatus = eq(new IR.Value(T4.status), new IR.Value('pending'));
      const orExpr = or(eqOwner, eqPublic);
      const andExpr = and(orExpr, eqStatus);

      console.log('=== TanStack operator expressions ===');
      console.log('eq(alice, bob):', JSON.stringify(eqOwner));
      console.log('eq(false, true):', JSON.stringify(eqPublic));
      console.log('or(eq, eq):', JSON.stringify(orExpr));
      console.log('and(or, eq):', JSON.stringify(andExpr));

      // Test the filter callback directly with a proxy (what TanStack does internally)
      // Import from local tanstack-db since these aren't publicly exported
      const { createSingleRowRefProxy, toExpression } = await import('../tanstack-db/packages/db/src/query/builder/ref-proxy.js');
      const { compileSingleRowExpression, toBooleanPredicate } = await import('../tanstack-db/packages/db/src/query/compiler/evaluators.js');

      const proxy = createSingleRowRefProxy<Task>();
      const expression = filter(proxy);
      console.log('=== Expression from proxy ===');
      console.log('Expression:', JSON.stringify(expression, null, 2));

      const evaluator = compileSingleRowExpression(toExpression(expression));
      console.log('=== Evaluating T4 ===');
      const rawResult = evaluator(T4 as any);
      const boolResult = toBooleanPredicate(rawResult);
      console.log('Raw result:', rawResult);
      console.log('Boolean predicate:', boolResult);
      console.log('T4 should be EXCLUDED:', !boolResult);

      // Subscribe directly to TanStack DB collection with the filter callback
      const collection = (tasksCap as any).collection;

      // Debug: Test the filter function directly on all items in collection
      console.log('=== Testing filter on each item in collection ===');
      const { createFilterFunctionFromExpression } = await import('../tanstack-db/packages/db/src/collection/change-events.js');
      const filterFn = createFilterFunctionFromExpression(toExpression(expression));
      for (const [key, value] of collection.entries()) {
        const result = filterFn(value);
        console.log(`Item ${key}:`, { ownerId: value.ownerId, isPublic: value.isPublic, status: value.status }, '=> filter result:', result);
      }

      let directItems: Task[] = [];
      const directSub = collection.subscribeChanges(
        (changes: any[]) => {
          // Track items from changes
          const items = new Map<string, Task>();
          for (const c of changes) {
            console.log('Change received:', c.type, c.key, { ownerId: c.value?.ownerId, isPublic: c.value?.isPublic, status: c.value?.status });
            if (c.type === 'insert' || c.type === 'update') {
              items.set(String(c.key), c.value);
            }
          }
          directItems = Array.from(items.values());
          console.log('Direct subscribeChanges callback received:', changes.length, 'changes');
        },
        { where: filter, includeInitialState: true }
      );
      // Keep subscription alive - add to cleanup
      activeSubscriptions.push({ [Symbol.dispose]: () => directSub.unsubscribe() } as any);

      await new Promise(resolve => setTimeout(resolve, 50));

      console.log('Direct TanStack DB result:', directItems.map((t: Task) => ({
        id: t.id,
        ownerId: t.ownerId,
        isPublic: t.isPublic,
        status: t.status
      })));

      // Should match: T1 (bob, pending), T3 (public, pending)
      // Should NOT match: T2 (bob but completed), T4 (alice private)
      expect(directItems).toHaveLength(2);
      expect(directItems.map(t => t.id).sort()).toEqual(['1', '3']);
    });
  });

  describe('CollectionCapability', () => {
    it('should enforce row filters', async () => {
      const roomCap = await factory.createRoom({
        roomId: 'test',
        collections: ['tasks']
      });
      const tasksCap = roomCap.getCollection<Task>('tasks')!;

      // Insert tasks
      await tasksCap.insert({ id: '1', title: 'Alice', ownerId: 'alice', isPublic: false, status: 'pending' }).isPersisted.promise;
      await tasksCap.insert({ id: '2', title: 'Bob', ownerId: 'bob', isPublic: false, status: 'pending' }).isPersisted.promise;
      await tasksCap.insert({ id: '3', title: 'Public', ownerId: 'alice', isPublic: true, status: 'pending' }).isPersisted.promise;

      // Attenuate using TanStack DB operators
      const bobFilter: WhereFilter<Task> = (row) =>
        or(eq(row.ownerId, 'bob'), eq(row.isPublic, true));

      const bobCap = tasksCap.attenuate({ additionalWhere: bobFilter });

      let currentItems: Task[] = [];
      const subscription = bobCap.list((items) => {
        currentItems = items;
      });
      activeSubscriptions.push(subscription);

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(currentItems).toHaveLength(2); // Bob's task + public
      expect(currentItems.map(t => t.id).sort()).toEqual(['2', '3']);
    });

    it('should support attenuation chaining', async () => {
      const roomCap = await factory.createRoom({
        roomId: 'test',
        collections: ['tasks']
      });
      const tasksCap = roomCap.getCollection<Task>('tasks')!;

      // Insert tasks
      await tasksCap.insert({ id: '1', title: 'Alice', ownerId: 'alice', isPublic: false, status: 'pending' }).isPersisted.promise;
      await tasksCap.insert({ id: '2', title: 'Bob', ownerId: 'bob', isPublic: false, status: 'pending' }).isPersisted.promise;
      await tasksCap.insert({ id: '3', title: 'Carol', ownerId: 'carol', isPublic: false, status: 'pending' }).isPersisted.promise;
      await tasksCap.insert({ id: '4', title: 'Public', ownerId: 'carol', isPublic: true, status: 'pending' }).isPersisted.promise;

      // First attenuation: team members only
      const teamFilter: WhereFilter<Task> = (row) =>
        or(
          eq(row.ownerId, 'alice'),
          eq(row.ownerId, 'bob'),
          eq(row.isPublic, true)
        );
      const teamCap = tasksCap.attenuate({ additionalWhere: teamFilter });

      // Second attenuation: only Bob's tasks or public
      const bobFilter: WhereFilter<Task> = (row) =>
        or(eq(row.ownerId, 'bob'), eq(row.isPublic, true));
      const bobCap = teamCap.attenuate({
        additionalWhere: bobFilter,
        removePermissions: ['delete']
      });

      // Subscribe to both capabilities
      let teamItems: Task[] = [];
      let bobItems: Task[] = [];

      const teamSub = teamCap.list((items) => {
        teamItems = items;
      });
      activeSubscriptions.push(teamSub);

      const bobSub = bobCap.list((items) => {
        bobItems = items;
      });
      activeSubscriptions.push(bobSub);

      await new Promise(resolve => setTimeout(resolve, 50));

      // Team cap can see alice, bob, and public (not carol's private)
      expect(teamItems).toHaveLength(3);

      // Bob cap can only see bob's and public (combined filters)
      expect(bobItems).toHaveLength(2);
      expect(bobItems.map(t => t.id).sort()).toEqual(['2', '4']);
    });

    it('should enforce permission restrictions', async () => {
      const roomCap = await factory.createRoom({
        roomId: 'test',
        collections: ['tasks']
      });
      const tasksCap = roomCap.getCollection<Task>('tasks')!;

      await tasksCap.insert({ id: '1', title: 'Task', ownerId: 'alice', isPublic: true, status: 'pending' }).isPersisted.promise;

      // Remove write and delete permissions
      const readOnlyCap = tasksCap.attenuate({
        removePermissions: ['write', 'delete']
      });

      // Subscribe to verify read works
      let currentItems: Task[] = [];
      const subscription = readOnlyCap.list((items) => {
        currentItems = items;
      });
      activeSubscriptions.push(subscription);

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(currentItems).toHaveLength(1);

      // Write should fail
      expect(() => readOnlyCap.insert({ id: '2', title: 'New', ownerId: 'bob', isPublic: true, status: 'pending' }))
        .toThrow('This capability does not permit writing');

      // Delete should fail
      expect(() => readOnlyCap.delete('1'))
        .toThrow('This capability does not permit deletion');
    });
  });

  describe('Reactive Updates', () => {
    it('should receive updates when data changes', async () => {
      const roomCap = await factory.createRoom({
        roomId: 'test',
        collections: ['tasks']
      });
      const tasksCap = roomCap.getCollection<Task>('tasks')!;

      const receivedUpdates: Task[][] = [];

      // Subscribe to list - this stays active and receives updates
      const subscription = tasksCap.list((items) => {
        receivedUpdates.push([...items]);
      });
      activeSubscriptions.push(subscription);

      // Wait for initial state
      await new Promise(resolve => setTimeout(resolve, 50));

      // Insert tasks - subscription should receive updates
      await tasksCap.insert({ id: '1', title: 'First', ownerId: 'alice', isPublic: true, status: 'pending' }).isPersisted.promise;
      await new Promise(resolve => setTimeout(resolve, 50));

      await tasksCap.insert({ id: '2', title: 'Second', ownerId: 'bob', isPublic: true, status: 'pending' }).isPersisted.promise;
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should have received multiple updates
      expect(receivedUpdates.length).toBeGreaterThanOrEqual(2);

      // Final state should have both items
      const lastUpdate = receivedUpdates[receivedUpdates.length - 1];
      expect(lastUpdate).toHaveLength(2);
    });

    it('should only receive filtered updates', async () => {
      const roomCap = await factory.createRoom({
        roomId: 'test',
        collections: ['tasks']
      });
      const tasksCap = roomCap.getCollection<Task>('tasks')!;

      const bobFilter: WhereFilter<Task> = (row) => eq(row.ownerId, 'bob');
      const bobCap = tasksCap.attenuate({ additionalWhere: bobFilter });

      const receivedUpdates: Task[][] = [];
      const subscription = bobCap.list((items) => {
        receivedUpdates.push([...items]);
      });
      activeSubscriptions.push(subscription);

      await new Promise(resolve => setTimeout(resolve, 50));

      // Insert Alice's task (should not appear in Bob's view)
      await tasksCap.insert({ id: '1', title: 'Alice Task', ownerId: 'alice', isPublic: false, status: 'pending' }).isPersisted.promise;
      await new Promise(resolve => setTimeout(resolve, 50));

      // Insert Bob's task (should appear)
      await tasksCap.insert({ id: '2', title: 'Bob Task', ownerId: 'bob', isPublic: false, status: 'pending' }).isPersisted.promise;
      await new Promise(resolve => setTimeout(resolve, 50));

      // Bob should only see his task
      const lastUpdate = receivedUpdates[receivedUpdates.length - 1];
      expect(lastUpdate).toHaveLength(1);
      expect(lastUpdate[0].ownerId).toBe('bob');
    });
  });

  describe('Security: Data Reference Protection', () => {
    it('should NOT allow data corruption via returned row mutation', async () => {
      const roomCap = await factory.createRoom({
        roomId: 'test',
        collections: ['tasks']
      });
      const tasksCap = roomCap.getCollection<Task>('tasks')!;

      await tasksCap.insert({ id: '1', title: 'Original', ownerId: 'alice', isPublic: true, status: 'pending' }).isPersisted.promise;

      // Subscribe to get the item
      let receivedItem: Task | undefined;
      const subscription = tasksCap.get('1', (item) => {
        receivedItem = item;
      });
      activeSubscriptions.push(subscription);

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(receivedItem!.title).toBe('Original');

      // ATTACK: Mutate the returned row
      receivedItem!.title = 'HACKED';
      receivedItem!.ownerId = 'eve';

      // Wait and check if the next callback still has original data
      await new Promise(resolve => setTimeout(resolve, 50));

      // SECURE: The subscription should still receive the original data
      // (the cloneRow in the capability should protect the source)
      let freshItem: Task | undefined;
      const freshSub = tasksCap.get('1', (item) => {
        freshItem = item;
      });
      activeSubscriptions.push(freshSub);

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(freshItem!.title).toBe('Original');
      expect(freshItem!.ownerId).toBe('alice');
    });

    it('should NOT allow data corruption via list result mutation', async () => {
      const roomCap = await factory.createRoom({
        roomId: 'test',
        collections: ['tasks']
      });
      const tasksCap = roomCap.getCollection<Task>('tasks')!;

      await tasksCap.insert({ id: '1', title: 'Task 1', ownerId: 'alice', isPublic: true, status: 'pending' }).isPersisted.promise;

      // Subscribe to get the list
      let receivedItems: Task[] = [];
      const subscription = tasksCap.list((items) => {
        receivedItems = items;
      });
      activeSubscriptions.push(subscription);

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(receivedItems[0].title).toBe('Task 1');

      // ATTACK: Mutate the list result
      receivedItems[0].title = 'HACKED';

      // Check with a fresh subscription
      let freshItems: Task[] = [];
      const freshSub = tasksCap.list((items) => {
        freshItems = items;
      });
      activeSubscriptions.push(freshSub);

      await new Promise(resolve => setTimeout(resolve, 50));

      // SECURE: Fresh subscription should have original data
      expect(freshItems[0].title).toBe('Task 1');
    });
  });

  describe('RoomCapability', () => {
    it('should support room-level attenuation', async () => {
      const roomCap = await factory.createRoom({
        roomId: 'test',
        collections: ['tasks', 'comments']
      });

      // Attenuate to only tasks collection with filter
      const bobFilter: WhereFilter<Task> = (row) => eq(row.ownerId, 'bob');
      const restrictedRoom = roomCap.attenuate<Task>({
        collections: ['tasks'],
        collectionRestrictions: new Map([
          ['tasks', { additionalWhere: bobFilter, removePermissions: ['delete'] }]
        ])
      });

      expect(restrictedRoom.listCollections()).toEqual(['tasks']);

      const tasksCap = restrictedRoom.getCollection<Task>('tasks')!;
      expect(tasksCap.hasPermission('read')).toBe(true);
      expect(tasksCap.hasPermission('delete')).toBe(false);
    });
  });

  describe('Filter Builder with TanStack DB Operators', () => {
    it('should support comparison operators from TanStack DB', async () => {
      interface Item { id: string; price: number; }

      const roomCap = await factory.createRoom({
        roomId: 'test',
        collections: ['items']
      });
      const itemsCap = roomCap.getCollection<Item>('items')!;

      await itemsCap.insert({ id: '1', price: 50 }).isPersisted.promise;
      await itemsCap.insert({ id: '2', price: 100 }).isPersisted.promise;
      await itemsCap.insert({ id: '3', price: 150 }).isPersisted.promise;

      // Test gt - subscribe and keep alive
      const expensiveFilter: WhereFilter<Item> = (row) => gt(row.price, 100);
      const expensiveCap = itemsCap.attenuate({ additionalWhere: expensiveFilter });

      let expensiveItems: Item[] = [];
      const expensiveSub = expensiveCap.list((items) => {
        expensiveItems = items;
      });
      activeSubscriptions.push(expensiveSub);

      // Test gte
      const atLeast100Filter: WhereFilter<Item> = (row) => gte(row.price, 100);
      const atLeast100Cap = itemsCap.attenuate({ additionalWhere: atLeast100Filter });

      let atLeast100Items: Item[] = [];
      const atLeast100Sub = atLeast100Cap.list((items) => {
        atLeast100Items = items;
      });
      activeSubscriptions.push(atLeast100Sub);

      // Test lt
      const cheapFilter: WhereFilter<Item> = (row) => lt(row.price, 100);
      const cheapCap = itemsCap.attenuate({ additionalWhere: cheapFilter });

      let cheapItems: Item[] = [];
      const cheapSub = cheapCap.list((items) => {
        cheapItems = items;
      });
      activeSubscriptions.push(cheapSub);

      // Test lte
      const upTo100Filter: WhereFilter<Item> = (row) => lte(row.price, 100);
      const upTo100Cap = itemsCap.attenuate({ additionalWhere: upTo100Filter });

      let upTo100Items: Item[] = [];
      const upTo100Sub = upTo100Cap.list((items) => {
        upTo100Items = items;
      });
      activeSubscriptions.push(upTo100Sub);

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(expensiveItems).toHaveLength(1);
      expect(expensiveItems[0].id).toBe('3');

      expect(atLeast100Items).toHaveLength(2);

      expect(cheapItems).toHaveLength(1);
      expect(cheapItems[0].id).toBe('1');

      expect(upTo100Items).toHaveLength(2);
    });

    it('should support not() operator from TanStack DB', async () => {
      const roomCap = await factory.createRoom({
        roomId: 'test',
        collections: ['tasks']
      });
      const tasksCap = roomCap.getCollection<Task>('tasks')!;

      await tasksCap.insert({ id: '1', title: 'Alice', ownerId: 'alice', isPublic: true, status: 'pending' }).isPersisted.promise;
      await tasksCap.insert({ id: '2', title: 'Bob', ownerId: 'bob', isPublic: true, status: 'pending' }).isPersisted.promise;

      const notBobFilter: WhereFilter<Task> = (row) => not(eq(row.ownerId, 'bob'));
      const notBobCap = tasksCap.attenuate({ additionalWhere: notBobFilter });

      let currentItems: Task[] = [];
      const subscription = notBobCap.list((items) => {
        currentItems = items;
      });
      activeSubscriptions.push(subscription);

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(currentItems).toHaveLength(1);
      expect(currentItems[0].ownerId).toBe('alice');
    });

    it('should support inArray operator', async () => {
      const roomCap = await factory.createRoom({
        roomId: 'test',
        collections: ['tasks']
      });
      const tasksCap = roomCap.getCollection<Task>('tasks')!;

      await tasksCap.insert({ id: '1', title: 'T1', ownerId: 'alice', isPublic: true, status: 'pending' }).isPersisted.promise;
      await tasksCap.insert({ id: '2', title: 'T2', ownerId: 'bob', isPublic: true, status: 'active' }).isPersisted.promise;
      await tasksCap.insert({ id: '3', title: 'T3', ownerId: 'carol', isPublic: true, status: 'completed' }).isPersisted.promise;

      const activeStatusFilter: WhereFilter<Task> = (row) =>
        inArray(row.status, ['pending', 'active']);
      const activeCap = tasksCap.attenuate({ additionalWhere: activeStatusFilter });

      let currentItems: Task[] = [];
      const subscription = activeCap.list((items) => {
        currentItems = items;
      });
      activeSubscriptions.push(subscription);

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(currentItems).toHaveLength(2);
      expect(currentItems.map(t => t.id).sort()).toEqual(['1', '2']);
    });
  });

  describe('Visibility Check for Mutations', () => {
    it('should prevent update on items not visible through filter', async () => {
      const roomCap = await factory.createRoom({
        roomId: 'test',
        collections: ['tasks']
      });
      const tasksCap = roomCap.getCollection<Task>('tasks')!;

      await tasksCap.insert({ id: '1', title: 'Alice Task', ownerId: 'alice', isPublic: false, status: 'pending' }).isPersisted.promise;

      // Bob can only see his tasks
      const bobFilter: WhereFilter<Task> = (row) => eq(row.ownerId, 'bob');
      const bobCap = tasksCap.attenuate({ additionalWhere: bobFilter });

      // Bob tries to update Alice's task - should fail
      expect(() => bobCap.update('1', (draft) => { draft.title = 'Hacked'; }))
        .toThrow('Item not found or not accessible through this capability');
    });

    it('should prevent delete on items not visible through filter', async () => {
      const roomCap = await factory.createRoom({
        roomId: 'test',
        collections: ['tasks']
      });
      const tasksCap = roomCap.getCollection<Task>('tasks')!;

      await tasksCap.insert({ id: '1', title: 'Alice Task', ownerId: 'alice', isPublic: false, status: 'pending' }).isPersisted.promise;

      // Bob can only see his tasks
      const bobFilter: WhereFilter<Task> = (row) => eq(row.ownerId, 'bob');
      const bobCap = tasksCap.attenuate({ additionalWhere: bobFilter });

      // Bob tries to delete Alice's task - should fail
      expect(() => bobCap.delete('1'))
        .toThrow('Item not found or not accessible through this capability');
    });

    it('should allow update on items visible through filter', async () => {
      const roomCap = await factory.createRoom({
        roomId: 'test',
        collections: ['tasks']
      });
      const tasksCap = roomCap.getCollection<Task>('tasks')!;

      await tasksCap.insert({ id: '1', title: 'Bob Task', ownerId: 'bob', isPublic: false, status: 'pending' }).isPersisted.promise;

      const bobFilter: WhereFilter<Task> = (row) => eq(row.ownerId, 'bob');
      const bobCap = tasksCap.attenuate({ additionalWhere: bobFilter });

      // Bob updates his own task - should succeed
      await bobCap.update('1', (draft) => { draft.title = 'Updated by Bob'; }).isPersisted.promise;

      // Verify via subscription
      let updatedItem: Task | undefined;
      const subscription = tasksCap.get('1', (item) => {
        updatedItem = item;
      });
      activeSubscriptions.push(subscription);

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(updatedItem!.title).toBe('Updated by Bob');
    });
  });
});
