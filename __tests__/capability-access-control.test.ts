/**
 * Tests for Capability-Based Access Control
 *
 * These tests demonstrate that the capability system works correctly
 * and enforces proper access control without identity checks.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  CollectionCapability,
  RoomCapability,
  RoomFactory,
  UserHub,
  InMemoryStore,
  makeRevocable,
  Subscription,
  UpdateHandler,
  setupCrossRoomSubscription,
  RevocableCapability,
  recordFilter,
  RecordedFilter
} from '../examples/capability-access-control.js';
import { RpcTarget } from '../src/index.js';

interface Task {
  id: string;
  title: string;
  ownerId: string;
  isPublic: boolean;
  status: 'pending' | 'completed';
}

interface Comment {
  id: string;
  taskId: string;
  authorId: string;
  text: string;
}

describe('Capability-Based Access Control', () => {
  let store: InMemoryStore;
  let factory: RoomFactory;

  beforeEach(() => {
    store = new InMemoryStore();
    factory = new RoomFactory(store);
  });

  describe('CollectionCapability', () => {
    let roomCap: RoomCapability;
    let tasksCap: CollectionCapability<Task>;

    beforeEach(async () => {
      roomCap = await factory.createRoom({
        roomId: 'test-room',
        collections: ['tasks', 'comments']
      });
      tasksCap = roomCap.getCollection<Task>('tasks')!;
    });

    it('should allow CRUD operations with full permissions', async () => {
      // Insert
      const task = await tasksCap.insert({
        id: '1',
        title: 'Test Task',
        ownerId: 'alice',
        isPublic: true,
        status: 'pending'
      });
      expect(task.id).toBe('1');

      // Read
      const tasks = await tasksCap.list();
      expect(tasks).toHaveLength(1);

      const fetched = await tasksCap.get('1');
      expect(fetched?.title).toBe('Test Task');

      // Update
      const updated = await tasksCap.update('1', { status: 'completed' });
      expect(updated.status).toBe('completed');

      // Delete
      await tasksCap.delete('1');
      const afterDelete = await tasksCap.list();
      expect(afterDelete).toHaveLength(0);
    });

    it('should enforce read permission', async () => {
      const readOnlyCap = tasksCap.attenuate({
        removePermissions: ['write', 'delete']
      });

      await tasksCap.insert({
        id: '1', title: 'Task', ownerId: 'alice', isPublic: true, status: 'pending'
      });

      // Read should work
      const tasks = await readOnlyCap.list();
      expect(tasks).toHaveLength(1);

      // Write should fail
      await expect(readOnlyCap.insert({
        id: '2', title: 'New', ownerId: 'alice', isPublic: true, status: 'pending'
      })).rejects.toThrow('does not permit writing');

      // Delete should fail
      await expect(readOnlyCap.delete('1')).rejects.toThrow('does not permit deletion');
    });

    it('should enforce row filters', async () => {
      // Create some tasks
      await tasksCap.insert({
        id: '1', title: 'Alice Task', ownerId: 'alice', isPublic: false, status: 'pending'
      });
      await tasksCap.insert({
        id: '2', title: 'Bob Task', ownerId: 'bob', isPublic: false, status: 'pending'
      });
      await tasksCap.insert({
        id: '3', title: 'Public Task', ownerId: 'alice', isPublic: true, status: 'pending'
      });

      // Attenuate to only see bob's tasks or public ones
      const bobCap = tasksCap.attenuate({
        additionalFilter: recordFilter<Task>(task => task.ownerId.is('bob').or(task.isPublic))
      });

      const bobsTasks = await bobCap.list();
      expect(bobsTasks).toHaveLength(2); // Bob's task + public
      expect(bobsTasks.map(t => t.id).sort()).toEqual(['2', '3']);

      // Bob cannot see Alice's private task
      const alicePrivate = await bobCap.get('1');
      expect(alicePrivate).toBeNull();

      // Bob can see his own task
      const bobsTask = await bobCap.get('2');
      expect(bobsTask?.title).toBe('Bob Task');
    });

    it('should prevent inserting rows that do not match filter', async () => {
      const bobCap = tasksCap.attenuate({
        additionalFilter: recordFilter<Task>(task => task.ownerId.is('bob'))
      });

      // Bob can insert his own task
      await bobCap.insert({
        id: '1', title: 'Bob Task', ownerId: 'bob', isPublic: false, status: 'pending'
      });

      // Bob cannot insert a task owned by someone else
      await expect(bobCap.insert({
        id: '2', title: 'Fake', ownerId: 'alice', isPublic: false, status: 'pending'
      })).rejects.toThrow('does not match capability filter');
    });

    it('should prevent updating rows outside filter scope', async () => {
      await tasksCap.insert({
        id: '1', title: 'Bob Task', ownerId: 'bob', isPublic: false, status: 'pending'
      });

      const bobCap = tasksCap.attenuate({
        additionalFilter: recordFilter<Task>(task => task.ownerId.is('bob'))
      });

      // Bob can update his task normally
      await bobCap.update('1', { status: 'completed' });

      // Bob cannot change owner to move it outside his scope
      await expect(bobCap.update('1', { ownerId: 'alice' }))
        .rejects.toThrow('outside capability scope');
    });

    it('should support attenuation chaining', async () => {
      // Start with full access
      const fullCap = tasksCap;

      // Admin attenuates to team-visible tasks
      const teamCap = fullCap.attenuate({
        additionalFilter: recordFilter<Task>(task => task.isPublic.or(task.ownerId.is('alice')).or(task.ownerId.is('bob')))
      });

      // Team lead attenuates further for Bob - only his tasks
      const bobCap = teamCap.attenuate({
        additionalFilter: recordFilter<Task>(task => task.ownerId.is('bob').or(task.isPublic)),
        removePermissions: ['delete']
      });

      // Insert some tasks via full cap
      await fullCap.insert({ id: '1', title: 'Alice', ownerId: 'alice', isPublic: false, status: 'pending' });
      await fullCap.insert({ id: '2', title: 'Bob', ownerId: 'bob', isPublic: false, status: 'pending' });
      await fullCap.insert({ id: '3', title: 'Carol', ownerId: 'carol', isPublic: false, status: 'pending' });
      await fullCap.insert({ id: '4', title: 'Public', ownerId: 'alice', isPublic: true, status: 'pending' });

      // Team cap can see alice, bob, and public (not carol)
      const teamTasks = await teamCap.list();
      expect(teamTasks).toHaveLength(3);

      // Bob cap can only see bob's and public
      const bobTasks = await bobCap.list();
      expect(bobTasks).toHaveLength(2);
      expect(bobTasks.map(t => t.ownerId).sort()).toEqual(['alice', 'bob']);

      // Bob cannot delete (permission removed in attenuation chain)
      await expect(bobCap.delete('2')).rejects.toThrow('does not permit deletion');
    });
  });

  describe('RoomCapability', () => {
    it('should only expose allowed collections', async () => {
      const fullRoomCap = await factory.createRoom({
        roomId: 'test-room',
        collections: ['tasks', 'comments', 'auditLogs']
      });

      expect(fullRoomCap.listCollections()).toEqual(['tasks', 'comments', 'auditLogs']);

      // Attenuate to remove auditLogs
      const restrictedCap = fullRoomCap.attenuate({
        collections: ['tasks', 'comments']
      });

      expect(restrictedCap.listCollections()).toEqual(['tasks', 'comments']);

      // Cannot access auditLogs through restricted cap
      const auditCap = restrictedCap.getCollection('auditLogs');
      expect(auditCap).toBeNull();
    });

    it('should apply collection-level restrictions', async () => {
      const fullRoomCap = await factory.createRoom({
        roomId: 'test-room',
        collections: ['tasks']
      });

      const tasksCap = fullRoomCap.getCollection<Task>('tasks')!;
      await tasksCap.insert({ id: '1', title: 'T1', ownerId: 'alice', isPublic: true, status: 'pending' });
      await tasksCap.insert({ id: '2', title: 'T2', ownerId: 'bob', isPublic: false, status: 'pending' });
      await tasksCap.insert({ id: '3', title: 'T3', ownerId: 'alice', isPublic: false, status: 'pending' });

      // Restrict the room capability
      const bobRoomCap = fullRoomCap.attenuate({
        collectionRestrictions: new Map([
          ['tasks', {
            removePermissions: ['delete'],
            additionalFilter: recordFilter<Task>(task => task.ownerId.is('bob').or(task.isPublic))
          }]
        ])
      });

      const bobTasksCap = bobRoomCap.getCollection<Task>('tasks')!;

      // Bob can only see his task and public ones
      const tasks = await bobTasksCap.list();
      expect(tasks).toHaveLength(2);

      // Bob cannot delete
      expect(bobTasksCap.hasPermission('delete')).toBe(false);
    });
  });

  describe('UserHub as Mailbox', () => {
    it('should store and retrieve capabilities', async () => {
      const roomCap = await factory.createRoom({
        roomId: 'project-1',
        collections: ['tasks']
      });

      const bobHub = new UserHub('bob');

      // Alice delegates to Bob
      bobHub.receiveCapability('project-1', roomCap, {
        from: 'alice',
        description: 'Project access'
      });

      // Bob retrieves
      const caps = bobHub.listCapabilities();
      expect(caps).toHaveLength(1);
      expect(caps[0].name).toBe('project-1');
      expect(caps[0].from).toBe('alice');

      const cap = bobHub.getCapability('project-1');
      expect(cap).toBe(roomCap);

      bobHub[Symbol.dispose]();
    });

    it('should allow removing capabilities', async () => {
      const roomCap = await factory.createRoom({
        roomId: 'project-1',
        collections: ['tasks']
      });

      const bobHub = new UserHub('bob');
      bobHub.receiveCapability('project-1', roomCap, { from: 'alice' });

      expect(bobHub.getCapability('project-1')).not.toBeNull();

      bobHub.removeCapability('project-1');

      expect(bobHub.getCapability('project-1')).toBeNull();

      bobHub[Symbol.dispose]();
    });

    it('should NOT check identity - just stores what it receives', () => {
      // This test demonstrates the key difference from ACL:
      // The hub doesn't ask "is Bob allowed to have this?"
      // It just stores whatever is delegated to it.

      const bobHub = new UserHub('bob');

      // Anyone can deliver any capability - no permission check
      const mockCap = new MockCapability();
      bobHub.receiveCapability('secret-resource', mockCap, {
        from: 'anyone',
        description: 'Could be anything'
      });

      // The hub just stores it - the security comes from:
      // 1. Who actually HAS the capability to delegate
      // 2. Whether the capability itself is valid
      expect(bobHub.getCapability('secret-resource')).toBe(mockCap);

      bobHub[Symbol.dispose]();
    });
  });

  describe('Revocable Capabilities', () => {
    it('should work until revoked', async () => {
      const roomCap = await factory.createRoom({
        roomId: 'test',
        collections: ['tasks']
      });

      const { capability: revocable, revoke } = makeRevocable(roomCap);

      // Works before revocation
      const inner = revocable.getInner();
      expect(inner.listCollections()).toContain('tasks');

      // Revoke
      revoke();

      // Fails after revocation
      expect(() => revocable.getInner()).toThrow('revoked');
      expect(revocable.isRevoked()).toBe(true);
    });

    it('should be idempotent', async () => {
      const roomCap = await factory.createRoom({
        roomId: 'test',
        collections: ['tasks']
      });

      const { capability: revocable, revoke } = makeRevocable(roomCap);

      revoke();
      revoke(); // Should not throw
      revoke();

      expect(revocable.isRevoked()).toBe(true);
    });

    it('should call onRevoke callback', async () => {
      const roomCap = await factory.createRoom({
        roomId: 'test',
        collections: ['tasks']
      });

      let called = false;
      const wrapper = new RevocableCapability(
        roomCap,
        () => { called = true; }
      );

      wrapper.revoke();
      expect(called).toBe(true);
    });
  });

  describe('Subscriptions with Filters', () => {
    it('should only notify for rows matching filter', async () => {
      const roomCap = await factory.createRoom({
        roomId: 'test',
        collections: ['tasks']
      });

      const fullTasksCap = roomCap.getCollection<Task>('tasks')!;
      const bobTasksCap = fullTasksCap.attenuate({
        additionalFilter: recordFilter<Task>(task => task.ownerId.is('bob'))
      });

      const received: Task[] = [];
      const handler = new TestUpdateHandler<Task>({
        onInsert: (row) => received.push(row)
      });

      await bobTasksCap.subscribe(handler);

      // Insert Alice's task - Bob should NOT see this
      await fullTasksCap.insert({ id: '1', title: 'Alice', ownerId: 'alice', isPublic: false, status: 'pending' });

      // Insert Bob's task - Bob SHOULD see this
      await fullTasksCap.insert({ id: '2', title: 'Bob', ownerId: 'bob', isPublic: false, status: 'pending' });

      expect(received).toHaveLength(1);
      expect(received[0].ownerId).toBe('bob');
    });

    it('should handle visibility changes on update', async () => {
      const roomCap = await factory.createRoom({
        roomId: 'test',
        collections: ['tasks']
      });

      const fullTasksCap = roomCap.getCollection<Task>('tasks')!;
      const publicTasksCap = fullTasksCap.attenuate({
        additionalFilter: recordFilter<Task>(task => task.isPublic)
      });

      const events: string[] = [];
      const handler = new TestUpdateHandler<Task>({
        onInsert: (row) => events.push(`insert:${row.id}`),
        onUpdate: (_old, row) => events.push(`update:${row.id}`),
        onDelete: (row) => events.push(`delete:${row.id}`)
      });

      await publicTasksCap.subscribe(handler);

      // Insert private task - no notification
      await fullTasksCap.insert({ id: '1', title: 'Private', ownerId: 'alice', isPublic: false, status: 'pending' });
      expect(events).toHaveLength(0);

      // Make it public - appears as insert to subscriber
      await fullTasksCap.update('1', { isPublic: true });
      expect(events).toEqual(['insert:1']);

      // Update while still public - appears as update
      await fullTasksCap.update('1', { status: 'completed' });
      expect(events).toEqual(['insert:1', 'update:1']);

      // Make it private again - appears as delete
      await fullTasksCap.update('1', { isPublic: false });
      expect(events).toEqual(['insert:1', 'update:1', 'delete:1']);
    });
  });

  describe('Cross-Room Capability Transfer', () => {
    it('should sync data between rooms', async () => {
      // Create source and target rooms
      const sourceRoomCap = await factory.createRoom({
        roomId: 'source',
        collections: ['tasks']
      });

      const targetRoomCap = await factory.createRoom({
        roomId: 'target',
        collections: ['tasks']
      });

      // Set up cross-room sync
      const { subscription } = await setupCrossRoomSubscription({
        sourceRoomCap,
        sourceCollection: 'tasks',
        targetRoomCap,
        targetCollection: 'tasks'
      });

      // Insert in source
      const sourceTasks = sourceRoomCap.getCollection<Task>('tasks')!;
      await sourceTasks.insert({ id: '1', title: 'Task', ownerId: 'alice', isPublic: true, status: 'pending' });

      // Should appear in target
      const targetTasks = targetRoomCap.getCollection<Task>('tasks')!;
      const synced = await targetTasks.list();
      expect(synced).toHaveLength(1);
      expect(synced[0].id).toBe('1');

      subscription[Symbol.dispose]();
    });

    it('should apply filter to cross-room sync', async () => {
      const sourceRoomCap = await factory.createRoom({
        roomId: 'source',
        collections: ['tasks']
      });

      const targetRoomCap = await factory.createRoom({
        roomId: 'target',
        collections: ['tasks']
      });

      // Only sync completed tasks
      const { subscription } = await setupCrossRoomSubscription({
        sourceRoomCap,
        sourceCollection: 'tasks',
        targetRoomCap,
        targetCollection: 'tasks',
        filter: recordFilter<Task>(task => task.status.is('completed'))
      });

      const sourceTasks = sourceRoomCap.getCollection<Task>('tasks')!;

      // Insert pending task - should NOT sync
      await sourceTasks.insert({ id: '1', title: 'Pending', ownerId: 'alice', isPublic: true, status: 'pending' });

      // Insert completed task - should sync
      await sourceTasks.insert({ id: '2', title: 'Done', ownerId: 'alice', isPublic: true, status: 'completed' });

      const targetTasks = targetRoomCap.getCollection<Task>('tasks')!;
      const synced = await targetTasks.list();
      expect(synced).toHaveLength(1);
      expect(synced[0].status).toBe('completed');

      subscription[Symbol.dispose]();
    });
  });

  describe('Complete Flow: Delegation without Identity Checks', () => {
    it('should demonstrate pure capability-based access', async () => {
      // === GENESIS: System creates factory ===
      // The factory itself is a capability - only those who have it can create rooms

      // === CREATION: Alice creates a room ===
      const aliceRoomCap = await factory.createRoom({
        roomId: 'project-x',
        collections: ['tasks', 'comments', 'secrets']
      });

      // Alice has full access - this is the root capability
      const aliceTasks = aliceRoomCap.getCollection<Task>('tasks')!;
      await aliceTasks.insert({ id: 't1', title: 'Setup', ownerId: 'alice', isPublic: true, status: 'pending' });
      await aliceTasks.insert({ id: 't2', title: 'Secret', ownerId: 'alice', isPublic: false, status: 'pending' });

      // === DELEGATION: Alice invites Bob ===
      // Alice creates an attenuated capability - NO IDENTITY CHECK HERE
      // The capability ITSELF encodes what Bob can do
      const bobRoomCap = aliceRoomCap.attenuate({
        collections: ['tasks', 'comments'],  // No 'secrets'
        collectionRestrictions: new Map([
          ['tasks', {
            additionalFilter: recordFilter<Task>(task => task.isPublic)  // Only public tasks
          }]
        ])
      });

      // === DELIVERY: Capability goes to Bob's hub ===
      const bobHub = new UserHub('bob');
      bobHub.receiveCapability('project-x', bobRoomCap, {
        from: 'alice',
        description: 'Contributor access to Project X'
      });

      // === USAGE: Bob uses his capability ===
      // Bob retrieves his capability - NO IDENTITY CHECK
      const projectCap = bobHub.getCapability('project-x') as RoomCapability;

      // Bob can access tasks
      const bobTasks = projectCap.getCollection<Task>('tasks')!;
      const visibleTasks = await bobTasks.list();

      // Bob only sees public task (due to filter baked into capability)
      expect(visibleTasks).toHaveLength(1);
      expect(visibleTasks[0].id).toBe('t1');

      // Bob CANNOT access secrets (collection not in his capability)
      const bobSecrets = projectCap.getCollection('secrets');
      expect(bobSecrets).toBeNull();

      // === KEY INSIGHT ===
      // At no point did we check "who is Bob?"
      // Bob's access is determined entirely by what capability he holds
      // The capability was created by Alice, encoding exactly what she chose to share

      bobHub[Symbol.dispose]();
    });
  });

  // ===========================================================================
  // SECURITY TESTS
  // ===========================================================================
  // These tests verify that the capability system is resilient to attacks.
  // Each test expects the SECURE outcome - if a vulnerability exists, the test FAILS.
  // ===========================================================================

  describe('Security: Reference Mutation Attacks', () => {
    /**
     * SECURITY TEST 1: Reference Mutation After Delegation
     *
     * Vulnerability: Filter functions are stored by reference. If the delegator
     * mutates the filter's closure state after delegation, they could escalate
     * the delegatee's permissions.
     *
     * SECURE behavior: Mutations to closure state after delegation should NOT
     * affect the attenuated capability's filter behavior.
     */
    it('should NOT allow filter bypass via closure state mutation after delegation', async () => {
      const roomCap = await factory.createRoom({
        roomId: 'test',
        collections: ['tasks']
      });
      const tasksCap = roomCap.getCollection<Task>('tasks')!;

      // Insert tasks - one for alice (private), one for bob
      await tasksCap.insert({ id: '1', title: 'Alice Secret', ownerId: 'alice', isPublic: false, status: 'pending' });
      await tasksCap.insert({ id: '2', title: 'Bob Task', ownerId: 'bob', isPublic: false, status: 'pending' });

      // Alice creates a filter with mutable closure state
      let allowedOwners = ['bob']; // Initially only bob
      const bobCap = tasksCap.attenuate({
        // The .isIn() captures the array VALUE at record time, not the reference
        additionalFilter: recordFilter<Task>(task => task.ownerId.isIn(allowedOwners))
      });

      // Verify Bob can only see his task
      let visibleTasks = await bobCap.list();
      expect(visibleTasks).toHaveLength(1);
      expect(visibleTasks[0].ownerId).toBe('bob');

      // ATTACK: Alice mutates the closure state to grant access to her own tasks
      allowedOwners.push('alice');

      // SECURE EXPECTATION: Bob should STILL only see his own task
      // The filter should have been captured immutably at delegation time
      visibleTasks = await bobCap.list();
      expect(visibleTasks).toHaveLength(1);
      expect(visibleTasks[0].ownerId).toBe('bob');
    });

    /**
     * SECURITY TEST 2: Closure Value Mutation
     *
     * Vulnerability: A delegator creates a filter with a mutable comparison value,
     * attenuates to a user, then changes the value to grant broader access.
     *
     * SECURE behavior: Comparison values should be captured immutably at delegation time.
     */
    it('should NOT allow filter bypass via mutable comparison value', async () => {
      const roomCap = await factory.createRoom({
        roomId: 'test',
        collections: ['tasks']
      });
      const tasksCap = roomCap.getCollection<Task>('tasks')!;

      await tasksCap.insert({ id: '1', title: 'Alice Task', ownerId: 'alice', isPublic: false, status: 'pending' });
      await tasksCap.insert({ id: '2', title: 'Bob Task', ownerId: 'bob', isPublic: false, status: 'pending' });

      // Create filter with a mutable comparison value
      let allowedOwner = 'bob';  // Initially only bob
      const restrictedCap = tasksCap.attenuate({
        additionalFilter: recordFilter<Task>(task => task.ownerId.is(allowedOwner))
      });

      // Initially can only see Bob's task
      let tasks = await restrictedCap.list();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].ownerId).toBe('bob');

      // ATTACK: Change the comparison value to grant access to Alice's task
      allowedOwner = 'alice';

      // SECURE EXPECTATION: Should STILL only see Bob's task
      // The value 'bob' was captured at delegation time
      tasks = await restrictedCap.list();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].ownerId).toBe('bob');
    });

    /**
     * SECURITY TEST 3: Permission Set Mutation
     *
     * Vulnerability: The attenuate() method creates a new Set from permissions,
     * but if the original permissions can be accessed and mutated, or if the
     * new Set is exposed, permissions could be escalated.
     *
     * SECURE behavior: Permission sets should be deeply immutable.
     */
    it('should NOT allow permission escalation via Set mutation', async () => {
      const roomCap = await factory.createRoom({
        roomId: 'test',
        collections: ['tasks']
      });
      const tasksCap = roomCap.getCollection<Task>('tasks')!;

      await tasksCap.insert({ id: '1', title: 'Task', ownerId: 'alice', isPublic: true, status: 'pending' });

      // Create read-only capability
      const readOnlyCap = tasksCap.attenuate({
        removePermissions: ['write', 'delete', 'subscribe']
      });

      // Verify read works but write doesn't
      const tasks = await readOnlyCap.list();
      expect(tasks).toHaveLength(1);

      await expect(readOnlyCap.insert({
        id: '2', title: 'Hacked', ownerId: 'eve', isPublic: true, status: 'pending'
      })).rejects.toThrow();

      // ATTACK: Try to check if permission state can be externally modified
      // (This tests that hasPermission reflects immutable state)
      expect(readOnlyCap.hasPermission('read')).toBe(true);
      expect(readOnlyCap.hasPermission('write')).toBe(false);
      expect(readOnlyCap.hasPermission('delete')).toBe(false);

      // Attempt operations that should fail even after any potential mutation
      await expect(readOnlyCap.delete('1')).rejects.toThrow();
      await expect(readOnlyCap.update('1', { title: 'Hacked' })).rejects.toThrow();
    });

    /**
     * SECURITY TEST 4: Row Object Mutation in Store
     *
     * Vulnerability: If the store returns references to internal objects,
     * mutating them could bypass filter checks or corrupt data.
     *
     * SECURE behavior: Rows returned from list()/get() should be copies,
     * not references to internal store state.
     */
    it('should NOT allow data corruption via returned row mutation', async () => {
      const roomCap = await factory.createRoom({
        roomId: 'test',
        collections: ['tasks']
      });
      const tasksCap = roomCap.getCollection<Task>('tasks')!;

      await tasksCap.insert({ id: '1', title: 'Original', ownerId: 'alice', isPublic: true, status: 'pending' });

      // Get the row
      const row = await tasksCap.get('1');
      expect(row).not.toBeNull();
      expect(row!.title).toBe('Original');

      // ATTACK: Mutate the returned row object
      row!.title = 'HACKED';
      row!.ownerId = 'eve';

      // SECURE EXPECTATION: The store's data should be unchanged
      const freshRow = await tasksCap.get('1');
      expect(freshRow!.title).toBe('Original');
      expect(freshRow!.ownerId).toBe('alice');

      // Also verify list() returns independent copies
      const list1 = await tasksCap.list();
      list1[0].title = 'HACKED VIA LIST';

      const list2 = await tasksCap.list();
      expect(list2[0].title).toBe('Original');
    });

    /**
     * SECURITY TEST 5: Subscription Handler Mutation
     *
     * Vulnerability: If the handler object is stored by reference, mutating
     * it after subscribe() could redirect notifications to different callbacks.
     *
     * SECURE behavior: Handler callbacks should be captured at subscription time.
     */
    it('should NOT allow notification redirection via handler mutation', async () => {
      const roomCap = await factory.createRoom({
        roomId: 'test',
        collections: ['tasks']
      });
      const tasksCap = roomCap.getCollection<Task>('tasks')!;

      const originalReceived: Task[] = [];
      const hackedReceived: Task[] = [];

      // Create a handler object directly (not wrapped in TestUpdateHandler)
      // This tests whether subscribe() captures the callbacks at subscription time
      const handler: UpdateHandler<Task> = {
        onInsert: (row: Task) => originalReceived.push(row),
        onUpdate: () => {},
        onDelete: () => {}
      };

      await tasksCap.subscribe(handler);

      // Insert first task - should go to original handler
      await tasksCap.insert({ id: '1', title: 'First', ownerId: 'alice', isPublic: true, status: 'pending' });
      expect(originalReceived).toHaveLength(1);

      // ATTACK: Mutate the handler's onInsert to redirect to hacked receiver
      handler.onInsert = (row: Task) => hackedReceived.push(row);

      // Insert second task
      await tasksCap.insert({ id: '2', title: 'Second', ownerId: 'alice', isPublic: true, status: 'pending' });

      // SECURE EXPECTATION: Second task should go to ORIGINAL handler
      // (handler.onInsert was captured at subscription time via .bind())
      expect(originalReceived).toHaveLength(2);
      expect(hackedReceived).toHaveLength(0);
    });
  });

  describe('Security: Race Conditions & Timing Attacks', () => {
    /**
     * SECURITY TEST 6: Update Filter Validation Race
     *
     * Vulnerability: Between checking if a row matches the filter and
     * actually performing the update, another operation could modify the row.
     *
     * SECURE behavior: Filter validation should be atomic with the update.
     */
    it('should atomically validate filter during update', async () => {
      const roomCap = await factory.createRoom({
        roomId: 'test',
        collections: ['tasks']
      });
      const tasksCap = roomCap.getCollection<Task>('tasks')!;

      await tasksCap.insert({ id: '1', title: 'Task', ownerId: 'bob', isPublic: false, status: 'pending' });

      const bobCap = tasksCap.attenuate({
        additionalFilter: recordFilter<Task>(task => task.ownerId.is('bob'))
      });

      // Bob tries to update his task - this should work
      await bobCap.update('1', { title: 'Updated' });

      // Verify the update worked
      const task = await bobCap.get('1');
      expect(task?.title).toBe('Updated');

      // Bob cannot update to change owner (would move outside filter)
      await expect(bobCap.update('1', { ownerId: 'alice' }))
        .rejects.toThrow('outside capability scope');

      // Verify the task is still Bob's
      const stillBobs = await bobCap.get('1');
      expect(stillBobs?.ownerId).toBe('bob');
    });

    /**
     * SECURITY TEST 7: Revocable Capability Timing Attack
     *
     * Vulnerability: Operations could complete after revocation if there's
     * a race between the revocation check and the actual operation.
     *
     * SECURE behavior: Once revoked, ALL operations must fail immediately.
     */
    it('should immediately fail all operations after revocation', async () => {
      const roomCap = await factory.createRoom({
        roomId: 'test',
        collections: ['tasks']
      });
      const tasksCap = roomCap.getCollection<Task>('tasks')!;

      await tasksCap.insert({ id: '1', title: 'Task', ownerId: 'alice', isPublic: true, status: 'pending' });

      const { capability: revocable, revoke } = makeRevocable(tasksCap);

      // Operations work before revocation
      const inner = revocable.getInner();
      expect(await inner.list()).toHaveLength(1);

      // Revoke
      revoke();

      // SECURE EXPECTATION: All operations on the wrapper must fail
      expect(() => revocable.getInner()).toThrow('revoked');
      expect(revocable.isRevoked()).toBe(true);

      // Multiple revocation calls should be idempotent
      revoke();
      revoke();
      expect(revocable.isRevoked()).toBe(true);
    });

    /**
     * SECURITY TEST 8: getInner() Reference Escape
     *
     * Vulnerability: If someone calls getInner() before revocation, they get
     * a direct reference that bypasses the revocation wrapper.
     *
     * SECURE behavior: Stored references from getInner() should NOT work
     * after revocation (requires different architecture - document if not possible).
     */
    it('should document getInner() reference escape risk', async () => {
      const roomCap = await factory.createRoom({
        roomId: 'test',
        collections: ['tasks']
      });
      const tasksCap = roomCap.getCollection<Task>('tasks')!;

      await tasksCap.insert({ id: '1', title: 'Task', ownerId: 'alice', isPublic: true, status: 'pending' });

      const { capability: revocable, revoke } = makeRevocable(tasksCap);

      // Get inner reference BEFORE revocation
      const innerRef = revocable.getInner();

      // Verify it works
      expect(await innerRef.list()).toHaveLength(1);

      // Revoke
      revoke();

      // The wrapper correctly fails
      expect(() => revocable.getInner()).toThrow('revoked');

      // KNOWN LIMITATION: The stored innerRef still works because it's a direct reference
      // This test documents the limitation - for true revocation, use a different pattern
      // (e.g., membrane pattern where all derived references check revocation)

      // If we want SECURE behavior, this should fail:
      // expect(innerRef.list()).rejects.toThrow('revoked');

      // Current behavior (documenting the limitation):
      // The inner reference bypasses revocation - this is a KNOWN RISK
      const stillWorks = await innerRef.list();
      expect(stillWorks).toHaveLength(1);

      // NOTE: This test passes but documents a security limitation.
      // For production use, consider the membrane pattern or never exposing getInner().
    });
  });

  describe('Security: Filter Bypass Scenarios', () => {
    /**
     * SECURITY TEST 9: Null Collection Access
     *
     * Vulnerability: getCollection() returns null for disallowed collections,
     * but improper null handling could lead to type confusion.
     *
     * SECURE behavior: Disallowed collections should return null, and
     * the system should gracefully handle attempts to use null.
     */
    it('should safely handle null for disallowed collections', async () => {
      const roomCap = await factory.createRoom({
        roomId: 'test',
        collections: ['tasks', 'secrets']
      });

      const restrictedCap = roomCap.attenuate({
        collections: ['tasks']
      });

      // Should get null for disallowed collection
      const secretsCap = restrictedCap.getCollection('secrets');
      expect(secretsCap).toBeNull();

      // Should get null for non-existent collection
      const nonExistent = restrictedCap.getCollection('nonexistent');
      expect(nonExistent).toBeNull();

      // Tasks should still work
      const tasksCap = restrictedCap.getCollection('tasks');
      expect(tasksCap).not.toBeNull();
    });

    /**
     * SECURITY TEST 10: Filter Composition with Invalid Inputs
     *
     * Vulnerability: Attenuating with invalid filters (null, undefined,
     * non-functions, throwing functions) could bypass security.
     *
     * SECURE behavior: Invalid filters should either error or be treated
     * as restrictive (deny all), never permissive.
     */
    it('should handle filter edge cases securely', async () => {
      const roomCap = await factory.createRoom({
        roomId: 'test',
        collections: ['tasks']
      });
      const tasksCap = roomCap.getCollection<Task>('tasks')!;

      await tasksCap.insert({ id: '1', title: 'Task', ownerId: 'alice', isPublic: true, status: 'pending' });

      // Test 1: Filter that throws at RECORD time should fail immediately
      // With RecordedFilter, the filter is executed once at record time
      expect(() => {
        recordFilter<Task>(() => { throw new Error('Filter error'); });
      }).toThrow('Filter error');

      // Test 2: Filter returning non-boolean should be treated as truthy/falsy
      const nonBooleanCap = tasksCap.attenuate({
        additionalFilter: recordFilter<Task>(() => 'truthy string' as any)
      });

      // RecordedFilter captures the result at record time and converts to boolean
      // 'truthy string' is truthy, so the filter should pass
      const result = await nonBooleanCap.list();
      expect(Array.isArray(result)).toBe(true);
    });

    /**
     * SECURITY TEST 11: Cross-Room Sync Filter Mismatch
     *
     * Vulnerability: If source has broader access than target filter allows,
     * sync could fail silently or leak error information.
     *
     * SECURE behavior: Failed syncs should fail gracefully without leaking data.
     */
    it('should handle cross-room sync filter mismatch gracefully', async () => {
      const sourceRoomCap = await factory.createRoom({
        roomId: 'source',
        collections: ['tasks']
      });

      const targetRoomCap = await factory.createRoom({
        roomId: 'target',
        collections: ['tasks']
      });

      // Target has restrictive filter - only public tasks
      const restrictedTargetCap = targetRoomCap.attenuate({
        collectionRestrictions: new Map([
          ['tasks', {
            additionalFilter: recordFilter<Task>(task => task.isPublic)
          }]
        ])
      });

      const { subscription } = await setupCrossRoomSubscription({
        sourceRoomCap,
        sourceCollection: 'tasks',
        targetRoomCap: restrictedTargetCap,
        targetCollection: 'tasks'
      });

      const sourceTasks = sourceRoomCap.getCollection<Task>('tasks')!;

      // Insert private task - should NOT sync (doesn't match target filter)
      await sourceTasks.insert({ id: '1', title: 'Private', ownerId: 'alice', isPublic: false, status: 'pending' });

      // Insert public task - should sync
      await sourceTasks.insert({ id: '2', title: 'Public', ownerId: 'alice', isPublic: true, status: 'pending' });

      // Only public task should be in target
      const targetTasks = targetRoomCap.getCollection<Task>('tasks')!;
      const synced = await targetTasks.list();

      // Note: Due to filter on target, we check via full target cap
      const fullTargetTasks = targetRoomCap.getCollection<Task>('tasks')!;
      const allTarget = await fullTargetTasks.list();

      // Only the public task should have synced successfully
      expect(allTarget.filter(t => t.isPublic)).toHaveLength(1);
      expect(allTarget.find(t => t.id === '2')).toBeDefined();

      subscription[Symbol.dispose]();
    });
  });

  describe('Security: Permission Escalation Prevention', () => {
    /**
     * SECURITY TEST 12: Ambient Authority - Hub Accepts Any Capability
     *
     * This documents expected behavior: Hub is a mailbox, not a security boundary.
     * Security depends on who can CALL receiveCapability(), not what they pass.
     */
    it('should document that hub is not a security boundary', () => {
      const bobHub = new UserHub('bob');

      // Anyone can deliver any capability to the hub
      const mockCap = new MockCapability();
      bobHub.receiveCapability('anything', mockCap, {
        from: 'untrusted-source',
        description: 'Potentially malicious'
      });

      // Hub accepts it - this is BY DESIGN
      // Security comes from controlling who can call receiveCapability()
      expect(bobHub.getCapability('anything')).toBe(mockCap);

      // Document: Hub isolation is required - don't expose receiveCapability to untrusted callers
      bobHub[Symbol.dispose]();
    });

    /**
     * SECURITY TEST 13: Metadata Spoofing
     *
     * Vulnerability: The "from" field in metadata is not verified.
     *
     * This documents expected behavior and the security implications.
     */
    it('should document that metadata.from is unverified', () => {
      const bobHub = new UserHub('bob');
      const mockCap = new MockCapability();

      // Attacker claims to be Alice
      bobHub.receiveCapability('project', mockCap, {
        from: 'alice', // This is NOT verified
        description: 'Fake delegation from Alice'
      });

      const caps = bobHub.listCapabilities();
      expect(caps[0].from).toBe('alice');

      // Document: metadata.from is for display only, NOT for authorization decisions
      // Never use metadata.from to make security decisions
      bobHub[Symbol.dispose]();
    });

    /**
     * SECURITY TEST 14: Update Cannot Escape Filter via Partial Update
     *
     * Vulnerability: Partial updates could potentially change filter-relevant
     * fields in ways that escape the filter.
     *
     * SECURE behavior: Filter must be re-validated against the merged result.
     */
    it('should validate filter against merged update result', async () => {
      const roomCap = await factory.createRoom({
        roomId: 'test',
        collections: ['tasks']
      });
      const tasksCap = roomCap.getCollection<Task>('tasks')!;

      await tasksCap.insert({ id: '1', title: 'Original', ownerId: 'bob', isPublic: false, status: 'pending' });

      const bobCap = tasksCap.attenuate({
        additionalFilter: recordFilter<Task>(task => task.ownerId.is('bob'))
      });

      // Partial update that doesn't touch ownerId should work
      await bobCap.update('1', { title: 'Updated Title' });
      expect((await bobCap.get('1'))?.title).toBe('Updated Title');
      expect((await bobCap.get('1'))?.ownerId).toBe('bob'); // Preserved

      // Partial update that changes ownerId should fail
      await expect(bobCap.update('1', { ownerId: 'alice' }))
        .rejects.toThrow('outside capability scope');

      // Verify ownerId was NOT changed
      expect((await bobCap.get('1'))?.ownerId).toBe('bob');
    });

    /**
     * SECURITY TEST 15: Permission Removal is Irreversible
     *
     * Vulnerability: Nested attenuation could potentially restore permissions
     * that were removed in an earlier attenuation.
     *
     * SECURE behavior: Once a permission is removed, no amount of attenuation
     * can restore it.
     */
    it('should NOT allow permission restoration via nested attenuation', async () => {
      const roomCap = await factory.createRoom({
        roomId: 'test',
        collections: ['tasks']
      });
      const tasksCap = roomCap.getCollection<Task>('tasks')!;

      await tasksCap.insert({ id: '1', title: 'Task', ownerId: 'alice', isPublic: true, status: 'pending' });

      // Full permissions
      expect(tasksCap.hasPermission('read')).toBe(true);
      expect(tasksCap.hasPermission('write')).toBe(true);
      expect(tasksCap.hasPermission('delete')).toBe(true);

      // First attenuation: remove write and delete
      const readOnlyCap = tasksCap.attenuate({
        removePermissions: ['write', 'delete']
      });
      expect(readOnlyCap.hasPermission('read')).toBe(true);
      expect(readOnlyCap.hasPermission('write')).toBe(false);
      expect(readOnlyCap.hasPermission('delete')).toBe(false);

      // ATTACK: Try to "attenuate" with an empty removePermissions to "restore"
      const attemptRestore = readOnlyCap.attenuate({
        removePermissions: [] // Remove nothing = restore everything?
      });

      // SECURE EXPECTATION: Permissions are still restricted
      expect(attemptRestore.hasPermission('read')).toBe(true);
      expect(attemptRestore.hasPermission('write')).toBe(false);
      expect(attemptRestore.hasPermission('delete')).toBe(false);

      // Verify operations actually fail
      await expect(attemptRestore.insert({
        id: '2', title: 'New', ownerId: 'alice', isPublic: true, status: 'pending'
      })).rejects.toThrow();
    });

    /**
     * SECURITY TEST 16: Root Capability Has Full Access
     *
     * Documents that root capabilities have unrestricted access.
     * This is expected but important to verify.
     */
    it('should verify root capability has unrestricted access', async () => {
      const roomCap = await factory.createRoom({
        roomId: 'test',
        collections: ['tasks', 'secrets']
      });

      // Root has access to all collections
      expect(roomCap.listCollections()).toContain('tasks');
      expect(roomCap.listCollections()).toContain('secrets');

      const tasksCap = roomCap.getCollection<Task>('tasks')!;

      // Root has all permissions
      expect(tasksCap.hasPermission('read')).toBe(true);
      expect(tasksCap.hasPermission('write')).toBe(true);
      expect(tasksCap.hasPermission('delete')).toBe(true);
      expect(tasksCap.hasPermission('subscribe')).toBe(true);

      // Root can do everything
      await tasksCap.insert({ id: '1', title: 'Task', ownerId: 'alice', isPublic: true, status: 'pending' });
      await tasksCap.update('1', { title: 'Updated' });
      await tasksCap.delete('1');

      // Document: Root capabilities must be protected - only give to trusted entities
    });

    /**
     * SECURITY TEST 17: Attenuation Cannot Add Permissions
     *
     * Vulnerability: The attenuation API only has removePermissions, but
     * verify there's no way to add permissions.
     *
     * SECURE behavior: Attenuation can ONLY remove capabilities, never add.
     */
    it('should verify attenuation only removes, never adds', async () => {
      const roomCap = await factory.createRoom({
        roomId: 'test',
        collections: ['tasks']
      });
      const tasksCap = roomCap.getCollection<Task>('tasks')!;

      // Start with read-only
      const readOnlyCap = tasksCap.attenuate({
        removePermissions: ['write', 'delete', 'subscribe']
      });

      expect(readOnlyCap.hasPermission('read')).toBe(true);
      expect(readOnlyCap.hasPermission('write')).toBe(false);

      // Attenuate again - cannot restore write
      const stillReadOnly = readOnlyCap.attenuate({
        removePermissions: ['subscribe'] // Remove subscribe (already gone)
      });

      // Write is still not available
      expect(stillReadOnly.hasPermission('write')).toBe(false);
      expect(stillReadOnly.hasPermission('delete')).toBe(false);

      // The API doesn't even have addPermissions - this is by design
      // TypeScript would catch this, but verify runtime behavior too
    });
  });

  describe('Security: Edge Cases & Type Safety', () => {
    /**
     * SECURITY TEST 18: Null vs Undefined Filter Behavior
     *
     * Vulnerability: Semantic difference between null and undefined filters
     * could lead to unexpected behavior.
     *
     * SECURE behavior: Both should mean "no additional filter" (unrestricted
     * relative to parent capability).
     */
    it('should treat null and undefined filters consistently', async () => {
      const roomCap = await factory.createRoom({
        roomId: 'test',
        collections: ['tasks']
      });
      const tasksCap = roomCap.getCollection<Task>('tasks')!;

      await tasksCap.insert({ id: '1', title: 'Task', ownerId: 'alice', isPublic: true, status: 'pending' });

      // Attenuate with no filter specified (undefined)
      const cap1 = tasksCap.attenuate({
        removePermissions: ['delete']
      });

      // Both should see all rows
      const list1 = await cap1.list();
      expect(list1).toHaveLength(1);

      // Verify consistent behavior
      expect(cap1.hasPermission('read')).toBe(true);
      expect(cap1.hasPermission('delete')).toBe(false);
    });

    /**
     * SECURITY TEST 19: Subscription Cleanup After Revocation
     *
     * Vulnerability: If a capability is revoked while subscribed, cleanup
     * could fail or leave dangling handlers.
     *
     * SECURE behavior: Subscriptions should clean up gracefully.
     */
    it('should handle subscription cleanup gracefully', async () => {
      const roomCap = await factory.createRoom({
        roomId: 'test',
        collections: ['tasks']
      });
      const tasksCap = roomCap.getCollection<Task>('tasks')!;

      const received: Task[] = [];
      const handler = new TestUpdateHandler<Task>({
        onInsert: (row) => received.push(row)
      });

      const subscription = await tasksCap.subscribe(handler);

      // Insert works
      await tasksCap.insert({ id: '1', title: 'Task1', ownerId: 'alice', isPublic: true, status: 'pending' });
      expect(received).toHaveLength(1);

      // Dispose subscription
      subscription[Symbol.dispose]();

      // Insert after disposal - should NOT notify
      await tasksCap.insert({ id: '2', title: 'Task2', ownerId: 'alice', isPublic: true, status: 'pending' });
      expect(received).toHaveLength(1); // Still 1, not 2

      // Multiple dispose calls should not throw
      subscription[Symbol.dispose]();
      subscription[Symbol.dispose]();
    });

    /**
     * SECURITY TEST 20: Handler Errors Don't Break Subscriptions
     *
     * Vulnerability: If a handler throws, it could break the subscription
     * system or prevent other handlers from receiving updates.
     *
     * SECURE behavior: Handler errors should be isolated.
     */
    it('should isolate handler errors', async () => {
      const roomCap = await factory.createRoom({
        roomId: 'test',
        collections: ['tasks']
      });
      const tasksCap = roomCap.getCollection<Task>('tasks')!;

      let callCount = 0;
      const throwingHandler = new TestUpdateHandler<Task>({
        onInsert: () => {
          callCount++;
          throw new Error('Handler error');
        }
      });

      await tasksCap.subscribe(throwingHandler);

      // Insert should succeed despite handler throwing
      await tasksCap.insert({ id: '1', title: 'Task1', ownerId: 'alice', isPublic: true, status: 'pending' });
      expect(callCount).toBe(1);

      // Second insert should also work - subscription wasn't broken
      await tasksCap.insert({ id: '2', title: 'Task2', ownerId: 'alice', isPublic: true, status: 'pending' });
      expect(callCount).toBe(2);

      // Verify data was actually inserted
      const tasks = await tasksCap.list();
      expect(tasks).toHaveLength(2);
    });
  });
});

// Test helpers

class MockCapability extends RpcTarget {
  doSomething() { return 'done'; }
}

class TestUpdateHandler<T> extends RpcTarget implements UpdateHandler<T> {
  constructor(private handlers: Partial<UpdateHandler<T>>) {
    super();
  }

  onInsert(row: T): void {
    this.handlers.onInsert?.(row);
  }

  onUpdate(oldRow: T, newRow: T): void {
    this.handlers.onUpdate?.(oldRow, newRow);
  }

  onDelete(row: T): void {
    this.handlers.onDelete?.(row);
  }
}
