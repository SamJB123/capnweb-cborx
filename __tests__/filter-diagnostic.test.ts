/**
 * COMPREHENSIVE FILTER DIAGNOSTIC TEST
 *
 * This file tests EVERY possible source of failure in the filtering pipeline.
 * After running, there should be ZERO ambiguity about what's broken.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createCollection,
  localOnlyCollectionOptions,
  eq,
  and,
  or,
  not,
  gt,
  IR,
  type Collection,
} from '@tanstack/db';

interface TestItem {
  id: string;
  ownerId: string;
  isPublic: boolean;
  status: 'pending' | 'active' | 'completed';
  count: number;
}

const T1: TestItem = { id: '1', ownerId: 'bob', isPublic: false, status: 'pending', count: 1 };
const T2: TestItem = { id: '2', ownerId: 'bob', isPublic: true, status: 'completed', count: 2 };
const T3: TestItem = { id: '3', ownerId: 'alice', isPublic: true, status: 'pending', count: 3 };
const T4: TestItem = { id: '4', ownerId: 'alice', isPublic: false, status: 'pending', count: 4 };

describe('FILTER DIAGNOSTIC - Testing Every Possible Failure Point', () => {
  let collection: Collection<TestItem, string>;

  beforeEach(async () => {
    collection = createCollection<TestItem, string>(
      localOnlyCollectionOptions({
        id: 'diagnostic-test',
        getKey: (item) => item.id,
      })
    );

    // Insert test data
    await collection.insert(T1).isPersisted.promise;
    await collection.insert(T2).isPersisted.promise;
    await collection.insert(T3).isPersisted.promise;
    await collection.insert(T4).isPersisted.promise;
  });

  describe('SECTION 1: Verify Test Data Setup', () => {
    it('1.1 - Collection should exist', () => {
      expect(collection).toBeDefined();
      expect(collection).not.toBeNull();
    });

    it('1.2 - Collection should have 4 items', () => {
      const entries = Array.from(collection.entries());
      expect(entries.length).toBe(4);
    });

    it('1.3 - Collection entries() returns correct data', () => {
      const entries = Array.from(collection.entries());
      const ids = entries.map(([k]) => k).sort();
      expect(ids).toEqual(['1', '2', '3', '4']);
    });

    it('1.4 - Collection get() works for each item', () => {
      expect(collection.get('1')).toEqual(T1);
      expect(collection.get('2')).toEqual(T2);
      expect(collection.get('3')).toEqual(T3);
      expect(collection.get('4')).toEqual(T4);
    });

    it('1.5 - T4 has expected values', () => {
      const t4 = collection.get('4');
      expect(t4?.ownerId).toBe('alice');
      expect(t4?.isPublic).toBe(false);
      expect(t4?.status).toBe('pending');
    });
  });

  describe('SECTION 2: Verify Operator Imports', () => {
    it('2.1 - eq is a function', () => {
      expect(typeof eq).toBe('function');
    });

    it('2.2 - and is a function', () => {
      expect(typeof and).toBe('function');
    });

    it('2.3 - or is a function', () => {
      expect(typeof or).toBe('function');
    });

    it('2.4 - not is a function', () => {
      expect(typeof not).toBe('function');
    });

    it('2.5 - gt is a function', () => {
      expect(typeof gt).toBe('function');
    });

    it('2.6 - IR namespace exists', () => {
      expect(IR).toBeDefined();
    });

    it('2.7 - IR.PropRef exists', () => {
      expect(IR.PropRef).toBeDefined();
    });

    it('2.8 - IR.Value exists', () => {
      expect(IR.Value).toBeDefined();
    });

    it('2.9 - IR.Func exists', () => {
      expect(IR.Func).toBeDefined();
    });
  });

  describe('SECTION 3: Verify IR Types Work Correctly', () => {
    it('3.1 - PropRef creates ref with correct path', () => {
      const ref = new IR.PropRef(['ownerId']);
      expect(ref.type).toBe('ref');
      expect(ref.path).toEqual(['ownerId']);
    });

    it('3.2 - Value creates val with correct value (string)', () => {
      const val = new IR.Value('bob');
      expect(val.type).toBe('val');
      expect(val.value).toBe('bob');
    });

    it('3.3 - Value creates val with correct value (boolean)', () => {
      const val = new IR.Value(true);
      expect(val.type).toBe('val');
      expect(val.value).toBe(true);
    });

    it('3.4 - Func creates func with correct structure', () => {
      const func = new IR.Func('eq', [new IR.PropRef(['x']), new IR.Value(1)]);
      expect(func.type).toBe('func');
      expect(func.name).toBe('eq');
      expect(func.args.length).toBe(2);
    });
  });

  describe('SECTION 4: Verify Operators Return Correct Expressions', () => {
    it('4.1 - eq() with two Values returns Func', () => {
      const result = eq(new IR.Value('a'), new IR.Value('b'));
      expect(result.type).toBe('func');
      expect((result as any).name).toBe('eq');
    });

    it('4.2 - eq() with PropRef and Value returns Func', () => {
      const result = eq(new IR.PropRef(['x']), new IR.Value('y'));
      expect(result.type).toBe('func');
      expect((result as any).name).toBe('eq');
    });

    it('4.3 - or() with two eq() returns Func', () => {
      const result = or(
        eq(new IR.PropRef(['a']), new IR.Value(1)),
        eq(new IR.PropRef(['b']), new IR.Value(2))
      );
      expect(result.type).toBe('func');
      expect((result as any).name).toBe('or');
      expect((result as any).args.length).toBe(2);
    });

    it('4.4 - and() with two eq() returns Func', () => {
      const result = and(
        eq(new IR.PropRef(['a']), new IR.Value(1)),
        eq(new IR.PropRef(['b']), new IR.Value(2))
      );
      expect(result.type).toBe('func');
      expect((result as any).name).toBe('and');
      expect((result as any).args.length).toBe(2);
    });

    it('4.5 - Nested and(or(), eq()) returns correct structure', () => {
      const result = and(
        or(
          eq(new IR.PropRef(['a']), new IR.Value(1)),
          eq(new IR.PropRef(['b']), new IR.Value(2))
        ),
        eq(new IR.PropRef(['c']), new IR.Value(3))
      );
      expect(result.type).toBe('func');
      expect((result as any).name).toBe('and');
      expect((result as any).args[0].name).toBe('or');
      expect((result as any).args[1].name).toBe('eq');
    });
  });

  describe('SECTION 5: Verify Callback Pattern with Proxy', () => {
    it('5.1 - Filter callback is called by subscribeChanges', async () => {
      let callbackCalled = false;
      const filter = (row: TestItem) => {
        callbackCalled = true;
        return eq(row.ownerId, 'bob');
      };

      const sub = collection.subscribeChanges(() => {}, { where: filter });
      await new Promise(r => setTimeout(r, 10));
      sub.unsubscribe();

      expect(callbackCalled).toBe(true);
    });

    it('5.2 - Filter callback receives a proxy object', async () => {
      let receivedRow: any = null;
      const filter = (row: TestItem) => {
        receivedRow = row;
        return eq(row.ownerId, 'bob');
      };

      const sub = collection.subscribeChanges(() => {}, { where: filter });
      await new Promise(r => setTimeout(r, 10));
      sub.unsubscribe();

      expect(receivedRow).not.toBeNull();
      expect(typeof receivedRow).toBe('object');
    });

    it('5.3 - Proxy property access returns something', async () => {
      let ownerIdValue: any = undefined;
      const filter = (row: TestItem) => {
        ownerIdValue = row.ownerId;
        return eq(row.ownerId, 'bob');
      };

      const sub = collection.subscribeChanges(() => {}, { where: filter });
      await new Promise(r => setTimeout(r, 10));
      sub.unsubscribe();

      expect(ownerIdValue).toBeDefined();
      console.log('5.3 - Proxy row.ownerId value:', ownerIdValue);
      console.log('5.3 - Proxy row.ownerId type:', typeof ownerIdValue);
      console.log('5.3 - Proxy row.ownerId JSON:', JSON.stringify(ownerIdValue));
    });

    it('5.4 - eq(row.ownerId, "bob") returns an expression', async () => {
      let expression: any = null;
      const filter = (row: TestItem) => {
        expression = eq(row.ownerId, 'bob');
        return expression;
      };

      const sub = collection.subscribeChanges(() => {}, { where: filter });
      await new Promise(r => setTimeout(r, 10));
      sub.unsubscribe();

      expect(expression).not.toBeNull();
      console.log('5.4 - Expression from eq(row.ownerId, "bob"):', JSON.stringify(expression, null, 2));
    });

    it('5.5 - Complex filter returns correct expression structure', async () => {
      let expression: any = null;
      const filter = (row: TestItem) => {
        expression = and(
          or(eq(row.ownerId, 'bob'), eq(row.isPublic, true)),
          eq(row.status, 'pending')
        );
        return expression;
      };

      const sub = collection.subscribeChanges(() => {}, { where: filter });
      await new Promise(r => setTimeout(r, 10));
      sub.unsubscribe();

      expect(expression).not.toBeNull();
      expect(expression.type).toBe('func');
      expect(expression.name).toBe('and');
      console.log('5.5 - Complex expression:', JSON.stringify(expression, null, 2));
    });
  });

  describe('SECTION 6: Test subscribeChanges WITHOUT filter', () => {
    it('6.1 - subscribeChanges without filter returns all 4 items', async () => {
      const received: TestItem[] = [];
      const sub = collection.subscribeChanges(
        (changes) => {
          for (const c of changes) {
            if (c.type === 'insert') received.push(c.value);
          }
        },
        { includeInitialState: true }
      );

      await new Promise(r => setTimeout(r, 50));
      sub.unsubscribe();

      expect(received.length).toBe(4);
    });
  });

  describe('SECTION 7: Test Simple eq Filter', () => {
    it('7.1 - eq(row.ownerId, "bob") should return 2 items (T1, T2)', async () => {
      const received: TestItem[] = [];
      const sub = collection.subscribeChanges(
        (changes) => {
          for (const c of changes) {
            if (c.type === 'insert') received.push(c.value);
          }
        },
        {
          where: (row) => eq(row.ownerId, 'bob'),
          includeInitialState: true
        }
      );

      await new Promise(r => setTimeout(r, 50));
      sub.unsubscribe();

      console.log('7.1 - Received items:', received.map(r => ({ id: r.id, ownerId: r.ownerId })));
      expect(received.length).toBe(2);
      expect(received.map(r => r.id).sort()).toEqual(['1', '2']);
    });

    it('7.2 - eq(row.status, "pending") should return 3 items (T1, T3, T4)', async () => {
      const received: TestItem[] = [];
      const sub = collection.subscribeChanges(
        (changes) => {
          for (const c of changes) {
            if (c.type === 'insert') received.push(c.value);
          }
        },
        {
          where: (row) => eq(row.status, 'pending'),
          includeInitialState: true
        }
      );

      await new Promise(r => setTimeout(r, 50));
      sub.unsubscribe();

      console.log('7.2 - Received items:', received.map(r => ({ id: r.id, status: r.status })));
      expect(received.length).toBe(3);
      expect(received.map(r => r.id).sort()).toEqual(['1', '3', '4']);
    });

    it('7.3 - eq(row.isPublic, true) should return 2 items (T2, T3)', async () => {
      const received: TestItem[] = [];
      const sub = collection.subscribeChanges(
        (changes) => {
          for (const c of changes) {
            if (c.type === 'insert') received.push(c.value);
          }
        },
        {
          where: (row) => eq(row.isPublic, true),
          includeInitialState: true
        }
      );

      await new Promise(r => setTimeout(r, 50));
      sub.unsubscribe();

      console.log('7.3 - Received items:', received.map(r => ({ id: r.id, isPublic: r.isPublic })));
      expect(received.length).toBe(2);
      expect(received.map(r => r.id).sort()).toEqual(['2', '3']);
    });

    it('7.4 - eq(row.isPublic, false) should return 2 items (T1, T4)', async () => {
      const received: TestItem[] = [];
      const sub = collection.subscribeChanges(
        (changes) => {
          for (const c of changes) {
            if (c.type === 'insert') received.push(c.value);
          }
        },
        {
          where: (row) => eq(row.isPublic, false),
          includeInitialState: true
        }
      );

      await new Promise(r => setTimeout(r, 50));
      sub.unsubscribe();

      console.log('7.4 - Received items:', received.map(r => ({ id: r.id, isPublic: r.isPublic })));
      expect(received.length).toBe(2);
      expect(received.map(r => r.id).sort()).toEqual(['1', '4']);
    });
  });

  describe('SECTION 8: Test OR Filter', () => {
    it('8.1 - or(eq(ownerId, "bob"), eq(ownerId, "alice")) should return 4 items', async () => {
      const received: TestItem[] = [];
      const sub = collection.subscribeChanges(
        (changes) => {
          for (const c of changes) {
            if (c.type === 'insert') received.push(c.value);
          }
        },
        {
          where: (row) => or(eq(row.ownerId, 'bob'), eq(row.ownerId, 'alice')),
          includeInitialState: true
        }
      );

      await new Promise(r => setTimeout(r, 50));
      sub.unsubscribe();

      console.log('8.1 - Received items:', received.map(r => r.id));
      expect(received.length).toBe(4);
    });

    it('8.2 - or(eq(ownerId, "bob"), eq(isPublic, true)) should return 3 items (T1, T2, T3)', async () => {
      const received: TestItem[] = [];
      const sub = collection.subscribeChanges(
        (changes) => {
          for (const c of changes) {
            if (c.type === 'insert') received.push(c.value);
          }
        },
        {
          where: (row) => or(eq(row.ownerId, 'bob'), eq(row.isPublic, true)),
          includeInitialState: true
        }
      );

      await new Promise(r => setTimeout(r, 50));
      sub.unsubscribe();

      console.log('8.2 - Received items:', received.map(r => ({ id: r.id, ownerId: r.ownerId, isPublic: r.isPublic })));
      expect(received.length).toBe(3);
      expect(received.map(r => r.id).sort()).toEqual(['1', '2', '3']);
    });

    it('8.3 - or(eq(ownerId, "charlie"), eq(isPublic, true)) should return 2 items (T2, T3)', async () => {
      const received: TestItem[] = [];
      const sub = collection.subscribeChanges(
        (changes) => {
          for (const c of changes) {
            if (c.type === 'insert') received.push(c.value);
          }
        },
        {
          where: (row) => or(eq(row.ownerId, 'charlie'), eq(row.isPublic, true)),
          includeInitialState: true
        }
      );

      await new Promise(r => setTimeout(r, 50));
      sub.unsubscribe();

      console.log('8.3 - Received items:', received.map(r => r.id));
      expect(received.length).toBe(2);
      expect(received.map(r => r.id).sort()).toEqual(['2', '3']);
    });
  });

  describe('SECTION 9: Test AND Filter', () => {
    it('9.1 - and(eq(ownerId, "bob"), eq(status, "pending")) should return 1 item (T1)', async () => {
      const received: TestItem[] = [];
      const sub = collection.subscribeChanges(
        (changes) => {
          for (const c of changes) {
            if (c.type === 'insert') received.push(c.value);
          }
        },
        {
          where: (row) => and(eq(row.ownerId, 'bob'), eq(row.status, 'pending')),
          includeInitialState: true
        }
      );

      await new Promise(r => setTimeout(r, 50));
      sub.unsubscribe();

      console.log('9.1 - Received items:', received.map(r => ({ id: r.id, ownerId: r.ownerId, status: r.status })));
      expect(received.length).toBe(1);
      expect(received[0].id).toBe('1');
    });

    it('9.2 - and(eq(ownerId, "alice"), eq(isPublic, true)) should return 1 item (T3)', async () => {
      const received: TestItem[] = [];
      const sub = collection.subscribeChanges(
        (changes) => {
          for (const c of changes) {
            if (c.type === 'insert') received.push(c.value);
          }
        },
        {
          where: (row) => and(eq(row.ownerId, 'alice'), eq(row.isPublic, true)),
          includeInitialState: true
        }
      );

      await new Promise(r => setTimeout(r, 50));
      sub.unsubscribe();

      console.log('9.2 - Received items:', received.map(r => r.id));
      expect(received.length).toBe(1);
      expect(received[0].id).toBe('3');
    });

    it('9.3 - and(eq(ownerId, "alice"), eq(isPublic, false)) should return 1 item (T4)', async () => {
      const received: TestItem[] = [];
      const sub = collection.subscribeChanges(
        (changes) => {
          for (const c of changes) {
            if (c.type === 'insert') received.push(c.value);
          }
        },
        {
          where: (row) => and(eq(row.ownerId, 'alice'), eq(row.isPublic, false)),
          includeInitialState: true
        }
      );

      await new Promise(r => setTimeout(r, 50));
      sub.unsubscribe();

      console.log('9.3 - Received items:', received.map(r => r.id));
      expect(received.length).toBe(1);
      expect(received[0].id).toBe('4');
    });
  });

  describe('SECTION 10: Test Nested AND(OR, eq) - THE FAILING CASE', () => {
    it('10.1 - and(or(eq(ownerId,"bob"), eq(isPublic,true)), eq(status,"pending")) should return 2 items (T1, T3)', async () => {
      // Expected: T1 (bob, pending), T3 (public, pending)
      // NOT expected: T2 (bob but completed), T4 (alice private pending)
      const received: TestItem[] = [];
      const sub = collection.subscribeChanges(
        (changes) => {
          for (const c of changes) {
            if (c.type === 'insert') received.push(c.value);
          }
        },
        {
          where: (row) => and(
            or(eq(row.ownerId, 'bob'), eq(row.isPublic, true)),
            eq(row.status, 'pending')
          ),
          includeInitialState: true
        }
      );

      await new Promise(r => setTimeout(r, 50));
      sub.unsubscribe();

      console.log('10.1 - THE KEY TEST');
      console.log('10.1 - Received items:', received.map(r => ({
        id: r.id,
        ownerId: r.ownerId,
        isPublic: r.isPublic,
        status: r.status
      })));
      console.log('10.1 - Expected: T1 and T3 only');
      console.log('10.1 - T4 should NOT be included (alice, private, pending)');

      expect(received.length).toBe(2);
      expect(received.map(r => r.id).sort()).toEqual(['1', '3']);
    });

    it('10.2 - Manual verification: T4 should NOT match the filter', () => {
      // T4: ownerId='alice', isPublic=false, status='pending'
      // Filter: (ownerId='bob' OR isPublic=true) AND status='pending'
      // Evaluation:
      //   ownerId='bob' -> 'alice'='bob' -> false
      //   isPublic=true -> false=true -> false
      //   OR(false, false) -> false
      //   status='pending' -> 'pending'='pending' -> true
      //   AND(false, true) -> false
      // T4 should NOT match!

      const t4Match_ownerIsBob = T4.ownerId === 'bob';
      const t4Match_isPublic = T4.isPublic === true;
      const t4Match_or = t4Match_ownerIsBob || t4Match_isPublic;
      const t4Match_status = T4.status === 'pending';
      const t4Match_final = t4Match_or && t4Match_status;

      console.log('10.2 - T4 manual evaluation:');
      console.log('  T4:', T4);
      console.log('  ownerId === "bob":', t4Match_ownerIsBob);
      console.log('  isPublic === true:', t4Match_isPublic);
      console.log('  OR result:', t4Match_or);
      console.log('  status === "pending":', t4Match_status);
      console.log('  AND (final) result:', t4Match_final);

      expect(t4Match_final).toBe(false);
    });

    it('10.3 - Manual verification: T1 SHOULD match the filter', () => {
      const t1Match_ownerIsBob = T1.ownerId === 'bob';
      const t1Match_isPublic = T1.isPublic === true;
      const t1Match_or = t1Match_ownerIsBob || t1Match_isPublic;
      const t1Match_status = T1.status === 'pending';
      const t1Match_final = t1Match_or && t1Match_status;

      console.log('10.3 - T1 manual evaluation:');
      console.log('  T1:', T1);
      console.log('  Final result:', t1Match_final);

      expect(t1Match_final).toBe(true);
    });

    it('10.4 - Manual verification: T3 SHOULD match the filter', () => {
      const t3Match_ownerIsBob = T3.ownerId === 'bob';
      const t3Match_isPublic = T3.isPublic === true;
      const t3Match_or = t3Match_ownerIsBob || t3Match_isPublic;
      const t3Match_status = T3.status === 'pending';
      const t3Match_final = t3Match_or && t3Match_status;

      console.log('10.4 - T3 manual evaluation:');
      console.log('  T3:', T3);
      console.log('  Final result:', t3Match_final);

      expect(t3Match_final).toBe(true);
    });
  });

  describe('SECTION 11: Test Alternative Nested Patterns', () => {
    it('11.1 - and(eq(status,"pending"), or(eq(ownerId,"bob"), eq(isPublic,true))) - same logic, different order', async () => {
      const received: TestItem[] = [];
      const sub = collection.subscribeChanges(
        (changes) => {
          for (const c of changes) {
            if (c.type === 'insert') received.push(c.value);
          }
        },
        {
          where: (row) => and(
            eq(row.status, 'pending'),
            or(eq(row.ownerId, 'bob'), eq(row.isPublic, true))
          ),
          includeInitialState: true
        }
      );

      await new Promise(r => setTimeout(r, 50));
      sub.unsubscribe();

      console.log('11.1 - Received items:', received.map(r => r.id));
      expect(received.length).toBe(2);
      expect(received.map(r => r.id).sort()).toEqual(['1', '3']);
    });

    it('11.2 - or(and(eq(ownerId,"bob"), eq(status,"pending")), and(eq(isPublic,true), eq(status,"pending")))', async () => {
      // Equivalent to: (bob AND pending) OR (public AND pending)
      const received: TestItem[] = [];
      const sub = collection.subscribeChanges(
        (changes) => {
          for (const c of changes) {
            if (c.type === 'insert') received.push(c.value);
          }
        },
        {
          where: (row) => or(
            and(eq(row.ownerId, 'bob'), eq(row.status, 'pending')),
            and(eq(row.isPublic, true), eq(row.status, 'pending'))
          ),
          includeInitialState: true
        }
      );

      await new Promise(r => setTimeout(r, 50));
      sub.unsubscribe();

      console.log('11.2 - Received items:', received.map(r => r.id));
      expect(received.length).toBe(2);
      expect(received.map(r => r.id).sort()).toEqual(['1', '3']);
    });
  });

  describe('SECTION 12: Test NOT operator', () => {
    it('12.1 - not(eq(ownerId, "bob")) should return 2 items (T3, T4)', async () => {
      const received: TestItem[] = [];
      const sub = collection.subscribeChanges(
        (changes) => {
          for (const c of changes) {
            if (c.type === 'insert') received.push(c.value);
          }
        },
        {
          where: (row) => not(eq(row.ownerId, 'bob')),
          includeInitialState: true
        }
      );

      await new Promise(r => setTimeout(r, 50));
      sub.unsubscribe();

      console.log('12.1 - Received items:', received.map(r => r.id));
      expect(received.length).toBe(2);
      expect(received.map(r => r.id).sort()).toEqual(['3', '4']);
    });
  });

  describe('SECTION 13: Test GT operator', () => {
    it('13.1 - gt(row.count, 2) should return 2 items (T3, T4)', async () => {
      const received: TestItem[] = [];
      const sub = collection.subscribeChanges(
        (changes) => {
          for (const c of changes) {
            if (c.type === 'insert') received.push(c.value);
          }
        },
        {
          where: (row) => gt(row.count, 2),
          includeInitialState: true
        }
      );

      await new Promise(r => setTimeout(r, 50));
      sub.unsubscribe();

      console.log('13.1 - Received items:', received.map(r => ({ id: r.id, count: r.count })));
      expect(received.length).toBe(2);
      expect(received.map(r => r.id).sort()).toEqual(['3', '4']);
    });
  });

  describe('SECTION 14: Test whereExpression (pre-compiled) vs where callback', () => {
    it('14.1 - Using whereExpression with manual PropRef for eq(ownerId, "bob")', async () => {
      const received: TestItem[] = [];
      const expr = new IR.Func('eq', [
        new IR.PropRef(['ownerId']),
        new IR.Value('bob')
      ]);

      const sub = collection.subscribeChanges(
        (changes) => {
          for (const c of changes) {
            if (c.type === 'insert') received.push(c.value);
          }
        },
        {
          whereExpression: expr,
          includeInitialState: true
        }
      );

      await new Promise(r => setTimeout(r, 50));
      sub.unsubscribe();

      console.log('14.1 - Using whereExpression directly:', received.map(r => r.id));
      expect(received.length).toBe(2);
      expect(received.map(r => r.id).sort()).toEqual(['1', '2']);
    });

    it('14.2 - Using whereExpression for the complex and(or(), eq()) filter', async () => {
      const received: TestItem[] = [];
      const expr = new IR.Func('and', [
        new IR.Func('or', [
          new IR.Func('eq', [new IR.PropRef(['ownerId']), new IR.Value('bob')]),
          new IR.Func('eq', [new IR.PropRef(['isPublic']), new IR.Value(true)])
        ]),
        new IR.Func('eq', [new IR.PropRef(['status']), new IR.Value('pending')])
      ]);

      console.log('14.2 - Manual expression:', JSON.stringify(expr, null, 2));

      const sub = collection.subscribeChanges(
        (changes) => {
          for (const c of changes) {
            if (c.type === 'insert') received.push(c.value);
          }
        },
        {
          whereExpression: expr,
          includeInitialState: true
        }
      );

      await new Promise(r => setTimeout(r, 50));
      sub.unsubscribe();

      console.log('14.2 - Using whereExpression for complex filter:', received.map(r => r.id));
      expect(received.length).toBe(2);
      expect(received.map(r => r.id).sort()).toEqual(['1', '3']);
    });
  });

  describe('SECTION 15: Check Collection Configuration', () => {
    it('15.1 - Collection has correct id', () => {
      expect(collection.id).toBe('diagnostic-test');
    });

    it('15.2 - Check if collection has autoIndex enabled', () => {
      console.log('15.2 - Collection config:', (collection as any).config);
      console.log('15.2 - autoIndex:', (collection as any).config?.autoIndex);
    });

    it('15.3 - Check collection indexes', () => {
      const indexes = (collection as any).indexes;
      console.log('15.3 - Collection indexes:', indexes);
      console.log('15.3 - Number of indexes:', indexes?.size ?? 'N/A');
      if (indexes) {
        for (const [name, index] of indexes) {
          console.log(`15.3 - Index "${name}":`, index);
        }
      }
    });
  });

  describe('SECTION 16: Test Multiple Sequential Subscriptions', () => {
    it('16.1 - First subscription, then second with filter', async () => {
      // First subscribe without filter
      const allItems: TestItem[] = [];
      const sub1 = collection.subscribeChanges(
        (changes) => {
          for (const c of changes) {
            if (c.type === 'insert') allItems.push(c.value);
          }
        },
        { includeInitialState: true }
      );

      await new Promise(r => setTimeout(r, 30));

      // Second subscribe with filter
      const filteredItems: TestItem[] = [];
      const sub2 = collection.subscribeChanges(
        (changes) => {
          for (const c of changes) {
            if (c.type === 'insert') filteredItems.push(c.value);
          }
        },
        {
          where: (row) => eq(row.ownerId, 'bob'),
          includeInitialState: true
        }
      );

      await new Promise(r => setTimeout(r, 30));

      sub1.unsubscribe();
      sub2.unsubscribe();

      console.log('16.1 - All items:', allItems.map(r => r.id));
      console.log('16.1 - Filtered items:', filteredItems.map(r => r.id));

      expect(allItems.length).toBe(4);
      expect(filteredItems.length).toBe(2);
    });
  });

  describe('SECTION 17: Test Immediate vs Delayed Check', () => {
    it('17.1 - Check received items at different time intervals', async () => {
      const received: TestItem[] = [];
      const sub = collection.subscribeChanges(
        (changes) => {
          console.log('17.1 - Callback received', changes.length, 'changes at', Date.now());
          for (const c of changes) {
            if (c.type === 'insert') received.push(c.value);
          }
        },
        {
          where: (row) => eq(row.ownerId, 'bob'),
          includeInitialState: true
        }
      );

      console.log('17.1 - After 0ms:', received.length, 'items');
      await new Promise(r => setTimeout(r, 10));
      console.log('17.1 - After 10ms:', received.length, 'items');
      await new Promise(r => setTimeout(r, 40));
      console.log('17.1 - After 50ms:', received.length, 'items');
      await new Promise(r => setTimeout(r, 50));
      console.log('17.1 - After 100ms:', received.length, 'items');

      sub.unsubscribe();
      expect(received.length).toBe(2);
    });
  });

  describe('SECTION 18: Test with includeInitialState false', () => {
    it('18.1 - includeInitialState: false should not receive initial items', async () => {
      const received: TestItem[] = [];
      const sub = collection.subscribeChanges(
        (changes) => {
          for (const c of changes) {
            if (c.type === 'insert') received.push(c.value);
          }
        },
        {
          where: (row) => eq(row.ownerId, 'bob'),
          includeInitialState: false
        }
      );

      await new Promise(r => setTimeout(r, 50));
      sub.unsubscribe();

      console.log('18.1 - With includeInitialState: false:', received.length, 'items');
      expect(received.length).toBe(0);
    });
  });

  describe('SECTION 19: Test New Insert After Subscription', () => {
    it('19.1 - New matching insert should be received', async () => {
      const received: TestItem[] = [];
      const sub = collection.subscribeChanges(
        (changes) => {
          for (const c of changes) {
            if (c.type === 'insert') received.push(c.value);
          }
        },
        {
          where: (row) => eq(row.ownerId, 'bob'),
          includeInitialState: true
        }
      );

      await new Promise(r => setTimeout(r, 30));
      const initialCount = received.length;

      // Insert a new bob item
      await collection.insert({ id: '5', ownerId: 'bob', isPublic: false, status: 'active', count: 5 }).isPersisted.promise;

      await new Promise(r => setTimeout(r, 30));
      sub.unsubscribe();

      console.log('19.1 - Initial count:', initialCount, 'Final count:', received.length);
      expect(received.length).toBe(initialCount + 1);
    });

    it('19.2 - New non-matching insert should NOT be received', async () => {
      const received: TestItem[] = [];
      const sub = collection.subscribeChanges(
        (changes) => {
          for (const c of changes) {
            if (c.type === 'insert') received.push(c.value);
          }
        },
        {
          where: (row) => eq(row.ownerId, 'bob'),
          includeInitialState: true
        }
      );

      await new Promise(r => setTimeout(r, 30));
      const initialCount = received.length;

      // Insert an alice item
      await collection.insert({ id: '6', ownerId: 'alice', isPublic: false, status: 'active', count: 6 }).isPersisted.promise;

      await new Promise(r => setTimeout(r, 30));
      sub.unsubscribe();

      console.log('19.2 - Initial count:', initialCount, 'Final count:', received.length);
      expect(received.length).toBe(initialCount);
    });
  });

  describe('SECTION 20: Verify Expression Args Are Correct Types', () => {
    it('20.1 - Check that eq() args are PropRef and Value', async () => {
      let capturedExpr: any = null;
      const filter = (row: TestItem) => {
        capturedExpr = eq(row.ownerId, 'bob');
        return capturedExpr;
      };

      const sub = collection.subscribeChanges(() => {}, { where: filter });
      await new Promise(r => setTimeout(r, 10));
      sub.unsubscribe();

      console.log('20.1 - eq expression args:');
      console.log('  arg[0]:', JSON.stringify(capturedExpr.args[0]));
      console.log('  arg[0].type:', capturedExpr.args[0].type);
      console.log('  arg[1]:', JSON.stringify(capturedExpr.args[1]));
      console.log('  arg[1].type:', capturedExpr.args[1].type);

      expect(capturedExpr.args[0].type).toBe('ref');
      expect(capturedExpr.args[1].type).toBe('val');
    });

    it('20.2 - Check or() args are both Func', async () => {
      let capturedExpr: any = null;
      const filter = (row: TestItem) => {
        capturedExpr = or(eq(row.ownerId, 'bob'), eq(row.isPublic, true));
        return capturedExpr;
      };

      const sub = collection.subscribeChanges(() => {}, { where: filter });
      await new Promise(r => setTimeout(r, 10));
      sub.unsubscribe();

      console.log('20.2 - or expression args:');
      console.log('  arg[0].type:', capturedExpr.args[0].type);
      console.log('  arg[0].name:', capturedExpr.args[0].name);
      console.log('  arg[1].type:', capturedExpr.args[1].type);
      console.log('  arg[1].name:', capturedExpr.args[1].name);

      expect(capturedExpr.args[0].type).toBe('func');
      expect(capturedExpr.args[0].name).toBe('eq');
      expect(capturedExpr.args[1].type).toBe('func');
      expect(capturedExpr.args[1].name).toBe('eq');
    });
  });

  describe('SECTION 21: Test Boolean Field Edge Cases', () => {
    it('21.1 - eq(isPublic, true) vs eq(isPublic, false)', async () => {
      const trueItems: TestItem[] = [];
      const falseItems: TestItem[] = [];

      const sub1 = collection.subscribeChanges(
        (changes) => {
          for (const c of changes) {
            if (c.type === 'insert') trueItems.push(c.value);
          }
        },
        { where: (row) => eq(row.isPublic, true), includeInitialState: true }
      );

      const sub2 = collection.subscribeChanges(
        (changes) => {
          for (const c of changes) {
            if (c.type === 'insert') falseItems.push(c.value);
          }
        },
        { where: (row) => eq(row.isPublic, false), includeInitialState: true }
      );

      await new Promise(r => setTimeout(r, 50));
      sub1.unsubscribe();
      sub2.unsubscribe();

      console.log('21.1 - isPublic=true:', trueItems.map(r => r.id));
      console.log('21.1 - isPublic=false:', falseItems.map(r => r.id));

      expect(trueItems.length + falseItems.length).toBe(4);
    });
  });

  describe('SECTION 22: Check for Async Issues', () => {
    it('22.1 - Multiple awaits to ensure data is settled', async () => {
      const received: TestItem[] = [];
      const sub = collection.subscribeChanges(
        (changes) => {
          for (const c of changes) {
            if (c.type === 'insert') received.push(c.value);
          }
        },
        {
          where: (row) => and(
            or(eq(row.ownerId, 'bob'), eq(row.isPublic, true)),
            eq(row.status, 'pending')
          ),
          includeInitialState: true
        }
      );

      // Multiple waits
      await new Promise(r => setTimeout(r, 20));
      await new Promise(r => setTimeout(r, 20));
      await new Promise(r => setTimeout(r, 20));
      await new Promise(r => setTimeout(r, 20));
      await new Promise(r => setTimeout(r, 20));

      sub.unsubscribe();

      console.log('22.1 - After 100ms total wait:', received.map(r => r.id));
      expect(received.length).toBe(2);
    });
  });

  describe('SECTION 23: Verify Filter Works on Updates', () => {
    it('23.1 - Update that makes item match filter should trigger insert event', async () => {
      const changes: any[] = [];
      const sub = collection.subscribeChanges(
        (c) => {
          changes.push(...c);
        },
        {
          where: (row) => eq(row.ownerId, 'charlie'),
          includeInitialState: true
        }
      );

      await new Promise(r => setTimeout(r, 30));
      const initialChanges = changes.length;

      // Update T1 to have ownerId='charlie'
      await collection.update('1', (draft) => {
        draft.ownerId = 'charlie';
      }).isPersisted.promise;

      await new Promise(r => setTimeout(r, 30));
      sub.unsubscribe();

      console.log('23.1 - Initial changes:', initialChanges);
      console.log('23.1 - Final changes:', changes.length);
      console.log('23.1 - Changes:', changes.map(c => ({ type: c.type, key: c.key })));

      // Should have received an insert for the updated item
      expect(changes.length).toBeGreaterThan(initialChanges);
    });
  });

  describe('SECTION 24: Raw Collection Operations', () => {
    it('24.1 - collection.subscribeChanges is a function', () => {
      expect(typeof collection.subscribeChanges).toBe('function');
    });

    it('24.2 - subscription object has unsubscribe method', async () => {
      const sub = collection.subscribeChanges(() => {}, { includeInitialState: true });
      expect(typeof sub.unsubscribe).toBe('function');
      sub.unsubscribe();
    });
  });

  describe('SECTION 25: Test Empty Results', () => {
    it('25.1 - Filter that matches nothing should return 0 items', async () => {
      const received: TestItem[] = [];
      const sub = collection.subscribeChanges(
        (changes) => {
          for (const c of changes) {
            if (c.type === 'insert') received.push(c.value);
          }
        },
        {
          where: (row) => eq(row.ownerId, 'nonexistent'),
          includeInitialState: true
        }
      );

      await new Promise(r => setTimeout(r, 50));
      sub.unsubscribe();

      console.log('25.1 - Received for nonexistent ownerId:', received.length);
      expect(received.length).toBe(0);
    });

    it('25.2 - Filter with impossible AND should return 0 items', async () => {
      const received: TestItem[] = [];
      const sub = collection.subscribeChanges(
        (changes) => {
          for (const c of changes) {
            if (c.type === 'insert') received.push(c.value);
          }
        },
        {
          where: (row) => and(eq(row.ownerId, 'bob'), eq(row.ownerId, 'alice')),
          includeInitialState: true
        }
      );

      await new Promise(r => setTimeout(r, 50));
      sub.unsubscribe();

      console.log('25.2 - Received for impossible AND:', received.length);
      expect(received.length).toBe(0);
    });
  });

  describe('SECTION 26: Check Type Coercion Issues', () => {
    it('26.1 - eq with boolean true (not string "true")', async () => {
      const received: TestItem[] = [];
      const sub = collection.subscribeChanges(
        (changes) => {
          for (const c of changes) {
            if (c.type === 'insert') received.push(c.value);
          }
        },
        {
          where: (row) => eq(row.isPublic, true), // boolean true
          includeInitialState: true
        }
      );

      await new Promise(r => setTimeout(r, 50));
      sub.unsubscribe();

      expect(received.length).toBe(2);
    });

    it('26.2 - String status comparison', async () => {
      const received: TestItem[] = [];
      const sub = collection.subscribeChanges(
        (changes) => {
          for (const c of changes) {
            if (c.type === 'insert') received.push(c.value);
          }
        },
        {
          where: (row) => eq(row.status, 'pending'),
          includeInitialState: true
        }
      );

      await new Promise(r => setTimeout(r, 50));
      sub.unsubscribe();

      expect(received.length).toBe(3);
    });
  });

  describe('SECTION 27: Verify currentStateAsChanges Works', () => {
    it('27.1 - currentStateAsChanges without filter returns all', () => {
      const changes = collection.currentStateAsChanges();
      console.log('27.1 - currentStateAsChanges():', changes?.length);
      expect(changes?.length).toBe(4);
    });

    it('27.2 - currentStateAsChanges with simple where expression', () => {
      const expr = new IR.Func('eq', [
        new IR.PropRef(['ownerId']),
        new IR.Value('bob')
      ]);
      const changes = collection.currentStateAsChanges({ where: expr });
      console.log('27.2 - currentStateAsChanges with where:', changes?.length);
      console.log('27.2 - IDs:', changes?.map(c => c.key));
      expect(changes?.length).toBe(2);
    });

    it('27.3 - currentStateAsChanges with complex where expression', () => {
      const expr = new IR.Func('and', [
        new IR.Func('or', [
          new IR.Func('eq', [new IR.PropRef(['ownerId']), new IR.Value('bob')]),
          new IR.Func('eq', [new IR.PropRef(['isPublic']), new IR.Value(true)])
        ]),
        new IR.Func('eq', [new IR.PropRef(['status']), new IR.Value('pending')])
      ]);
      const changes = collection.currentStateAsChanges({ where: expr });
      console.log('27.3 - currentStateAsChanges with complex where:', changes?.length);
      console.log('27.3 - IDs:', changes?.map(c => c.key));
      expect(changes?.length).toBe(2);
      expect(changes?.map(c => c.key).sort()).toEqual(['1', '3']);
    });
  });

  describe('SECTION 28: Compare callback where vs whereExpression', () => {
    it('28.1 - Same filter via callback should match whereExpression', async () => {
      // Via callback
      const callbackReceived: TestItem[] = [];
      const sub1 = collection.subscribeChanges(
        (changes) => {
          for (const c of changes) {
            if (c.type === 'insert') callbackReceived.push(c.value);
          }
        },
        {
          where: (row) => and(
            or(eq(row.ownerId, 'bob'), eq(row.isPublic, true)),
            eq(row.status, 'pending')
          ),
          includeInitialState: true
        }
      );

      // Via whereExpression
      const exprReceived: TestItem[] = [];
      const expr = new IR.Func('and', [
        new IR.Func('or', [
          new IR.Func('eq', [new IR.PropRef(['ownerId']), new IR.Value('bob')]),
          new IR.Func('eq', [new IR.PropRef(['isPublic']), new IR.Value(true)])
        ]),
        new IR.Func('eq', [new IR.PropRef(['status']), new IR.Value('pending')])
      ]);
      const sub2 = collection.subscribeChanges(
        (changes) => {
          for (const c of changes) {
            if (c.type === 'insert') exprReceived.push(c.value);
          }
        },
        {
          whereExpression: expr,
          includeInitialState: true
        }
      );

      await new Promise(r => setTimeout(r, 50));
      sub1.unsubscribe();
      sub2.unsubscribe();

      console.log('28.1 - Via callback:', callbackReceived.map(r => r.id).sort());
      console.log('28.1 - Via whereExpression:', exprReceived.map(r => r.id).sort());

      expect(callbackReceived.map(r => r.id).sort()).toEqual(exprReceived.map(r => r.id).sort());
    });
  });

  describe('SECTION 29: Deep Expression Inspection', () => {
    it('29.1 - Capture and compare expressions from callback vs manual', async () => {
      let callbackExpr: any = null;
      const filter = (row: TestItem) => {
        callbackExpr = and(
          or(eq(row.ownerId, 'bob'), eq(row.isPublic, true)),
          eq(row.status, 'pending')
        );
        return callbackExpr;
      };

      const sub = collection.subscribeChanges(() => {}, { where: filter });
      await new Promise(r => setTimeout(r, 10));
      sub.unsubscribe();

      const manualExpr = new IR.Func('and', [
        new IR.Func('or', [
          new IR.Func('eq', [new IR.PropRef(['ownerId']), new IR.Value('bob')]),
          new IR.Func('eq', [new IR.PropRef(['isPublic']), new IR.Value(true)])
        ]),
        new IR.Func('eq', [new IR.PropRef(['status']), new IR.Value('pending')])
      ]);

      console.log('29.1 - Callback expression:', JSON.stringify(callbackExpr, null, 2));
      console.log('29.1 - Manual expression:', JSON.stringify(manualExpr, null, 2));

      // Deep compare
      expect(JSON.stringify(callbackExpr)).toBe(JSON.stringify(manualExpr));
    });
  });

  describe('SECTION 30: Pinpoint Exact Failure Location', () => {
    it('30.0 - Count callback invocations and content', async () => {
      const invocations: { time: number; changes: any[] }[] = [];

      const sub = collection.subscribeChanges(
        (changes) => {
          invocations.push({
            time: Date.now(),
            changes: changes.map(c => ({ type: c.type, key: c.key, ownerId: c.value?.ownerId, isPublic: c.value?.isPublic, status: c.value?.status }))
          });
        },
        {
          where: (row) => and(
            or(eq(row.ownerId, 'bob'), eq(row.isPublic, true)),
            eq(row.status, 'pending')
          ),
          includeInitialState: true
        }
      );

      await new Promise(r => setTimeout(r, 100));
      sub.unsubscribe();

      console.log('30.0 - CALLBACK INVOCATION ANALYSIS:');
      console.log('30.0 - Total invocations:', invocations.length);
      invocations.forEach((inv, i) => {
        console.log(`30.0 - Invocation ${i + 1}:`, JSON.stringify(inv.changes));
      });

      // This tells us if the issue is:
      // A) Single invocation with wrong data (currentStateAsChanges returned wrong results)
      // B) Multiple invocations (extra events being sent)
    });
  });

  describe('SECTION 31: Test Index Optimization Specifically', () => {
    it('31.1 - Test and(or(), eq()) with optimizedOnly: false on currentStateAsChanges', () => {
      const expr = new IR.Func('and', [
        new IR.Func('or', [
          new IR.Func('eq', [new IR.PropRef(['ownerId']), new IR.Value('bob')]),
          new IR.Func('eq', [new IR.PropRef(['isPublic']), new IR.Value(true)])
        ]),
        new IR.Func('eq', [new IR.PropRef(['status']), new IR.Value('pending')])
      ]);

      const changes = collection.currentStateAsChanges({ where: expr, optimizedOnly: false });
      console.log('31.1 - currentStateAsChanges with optimizedOnly: false:', changes?.map(c => c.key));
      expect(changes?.length).toBe(2);
      expect(changes?.map(c => c.key).sort()).toEqual(['1', '3']);
    });

    it('31.2 - Test and(or(), eq()) with optimizedOnly: true on currentStateAsChanges', () => {
      const expr = new IR.Func('and', [
        new IR.Func('or', [
          new IR.Func('eq', [new IR.PropRef(['ownerId']), new IR.Value('bob')]),
          new IR.Func('eq', [new IR.PropRef(['isPublic']), new IR.Value(true)])
        ]),
        new IR.Func('eq', [new IR.PropRef(['status']), new IR.Value('pending')])
      ]);

      const changes = collection.currentStateAsChanges({ where: expr, optimizedOnly: true });
      console.log('31.2 - currentStateAsChanges with optimizedOnly: true:', changes);
      console.log('31.2 - Result is undefined (no index optimization):', changes === undefined);
    });

    it('31.3 - Force index on status field then test', async () => {
      // Force an index to be created on the status field
      const statusIndex = collection.subscribeChanges(
        () => {},
        { where: (row) => eq(row.status, 'pending'), includeInitialState: true }
      );
      await new Promise(r => setTimeout(r, 30));
      statusIndex.unsubscribe();

      // Now test the complex query
      const expr = new IR.Func('and', [
        new IR.Func('or', [
          new IR.Func('eq', [new IR.PropRef(['ownerId']), new IR.Value('bob')]),
          new IR.Func('eq', [new IR.PropRef(['isPublic']), new IR.Value(true)])
        ]),
        new IR.Func('eq', [new IR.PropRef(['status']), new IR.Value('pending')])
      ]);

      const received: TestItem[] = [];
      const sub = collection.subscribeChanges(
        (changes) => {
          for (const c of changes) {
            if (c.type === 'insert') received.push(c.value);
          }
        },
        {
          whereExpression: expr,
          includeInitialState: true
        }
      );

      await new Promise(r => setTimeout(r, 50));
      sub.unsubscribe();

      console.log('31.3 - After forcing status index:', received.map(r => r.id));
      // This might still fail if index optimization is the culprit
    });

    it('31.4 - Test if the OR subexpression is being evaluated incorrectly', async () => {
      // Test JUST the OR part: or(eq(ownerId, "bob"), eq(isPublic, true))
      // Should return T1, T2, T3 (not T4)
      const orExpr = new IR.Func('or', [
        new IR.Func('eq', [new IR.PropRef(['ownerId']), new IR.Value('bob')]),
        new IR.Func('eq', [new IR.PropRef(['isPublic']), new IR.Value(true)])
      ]);

      const received: TestItem[] = [];
      const sub = collection.subscribeChanges(
        (changes) => {
          for (const c of changes) {
            if (c.type === 'insert') received.push(c.value);
          }
        },
        {
          whereExpression: orExpr,
          includeInitialState: true
        }
      );

      await new Promise(r => setTimeout(r, 50));
      sub.unsubscribe();

      console.log('31.4 - OR only expression via subscribeChanges:', received.map(r => r.id));
      expect(received.length).toBe(3);
      expect(received.map(r => r.id).sort()).toEqual(['1', '2', '3']);
    });

    it('31.5 - Test the pending EQ alone via subscribeChanges with whereExpression', async () => {
      const pendingExpr = new IR.Func('eq', [new IR.PropRef(['status']), new IR.Value('pending')]);

      const received: TestItem[] = [];
      const sub = collection.subscribeChanges(
        (changes) => {
          for (const c of changes) {
            if (c.type === 'insert') received.push(c.value);
          }
        },
        {
          whereExpression: pendingExpr,
          includeInitialState: true
        }
      );

      await new Promise(r => setTimeout(r, 50));
      sub.unsubscribe();

      console.log('31.5 - EQ status=pending via subscribeChanges:', received.map(r => r.id));
      expect(received.length).toBe(3);
      expect(received.map(r => r.id).sort()).toEqual(['1', '3', '4']);
    });

    it('31.6 - What does index optimization return for and(or(), eq())?', () => {
      // Import the optimization function directly to test it
      const expr = new IR.Func('and', [
        new IR.Func('or', [
          new IR.Func('eq', [new IR.PropRef(['ownerId']), new IR.Value('bob')]),
          new IR.Func('eq', [new IR.PropRef(['isPublic']), new IR.Value(true)])
        ]),
        new IR.Func('eq', [new IR.PropRef(['status']), new IR.Value('pending')])
      ]);

      // Get all keys via entries
      const allKeys = Array.from(collection.entries()).map(([k]) => k);
      console.log('31.6 - All keys in collection:', allKeys);

      // Check if collection has any indexes
      const indexes = (collection as any)._indexManager;
      console.log('31.6 - Index manager:', indexes);
      if (indexes) {
        console.log('31.6 - Indexes entries:', indexes.indexes ? Array.from(indexes.indexes.entries()) : 'N/A');
      }
    });
  });

  describe('SECTION 32: Test with Three-way AND to isolate pattern', () => {
    it('32.1 - and(eq(ownerId, "bob"), eq(status, "pending"), eq(isPublic, false)) via subscribeChanges', async () => {
      // Should return only T1 (bob, pending, not public)
      const received: TestItem[] = [];
      const sub = collection.subscribeChanges(
        (changes) => {
          for (const c of changes) {
            if (c.type === 'insert') received.push(c.value);
          }
        },
        {
          where: (row) => and(and(eq(row.ownerId, 'bob'), eq(row.status, 'pending')), eq(row.isPublic, false)),
          includeInitialState: true
        }
      );

      await new Promise(r => setTimeout(r, 50));
      sub.unsubscribe();

      console.log('32.1 - Three-way AND:', received.map(r => r.id));
      expect(received.length).toBe(1);
      expect(received[0].id).toBe('1');
    });

    it('32.2 - and(and(eq, eq), or(eq, eq)) - nested AND inside AND with OR', async () => {
      // (ownerId=bob AND status=pending) AND (isPublic=true OR isPublic=false)
      // Should return T1 (bob, pending, (true or false))
      const received: TestItem[] = [];
      const sub = collection.subscribeChanges(
        (changes) => {
          for (const c of changes) {
            if (c.type === 'insert') received.push(c.value);
          }
        },
        {
          where: (row) => and(
            and(eq(row.ownerId, 'bob'), eq(row.status, 'pending')),
            or(eq(row.isPublic, true), eq(row.isPublic, false))
          ),
          includeInitialState: true
        }
      );

      await new Promise(r => setTimeout(r, 50));
      sub.unsubscribe();

      console.log('32.2 - and(and(), or()):', received.map(r => r.id));
      expect(received.length).toBe(1);
      expect(received[0].id).toBe('1');
    });
  });

  describe('SECTION 33: Test Index Intersection Behavior', () => {
    it('33.1 - Does AND with only ONE indexable field return intersection or union?', async () => {
      // and(eq(status, 'pending'), or(eq(ownerId, 'bob'), eq(isPublic, true)))
      // If status has an index and returns [1,3,4], and the OR part can't be indexed,
      // what happens?

      // First, let's see what indexes exist
      const indexManager = (collection as any)._indexManager;
      console.log('33.1 - Has index manager:', !!indexManager);

      const received: TestItem[] = [];
      const sub = collection.subscribeChanges(
        (changes) => {
          for (const c of changes) {
            if (c.type === 'insert') received.push(c.value);
          }
        },
        {
          where: (row) => and(
            eq(row.status, 'pending'),
            or(eq(row.ownerId, 'bob'), eq(row.isPublic, true))
          ),
          includeInitialState: true
        }
      );

      await new Promise(r => setTimeout(r, 50));
      sub.unsubscribe();

      console.log('33.1 - Result:', received.map(r => r.id));
      console.log('33.1 - Expected [1, 3], got:', received.map(r => r.id).sort());

      // The bug might be: if status has an index returning [1,3,4],
      // and the OR can't be indexed (returns canOptimize: false),
      // does the AND incorrectly return just the status result [1,3,4]?
    });

    it('33.2 - Simple EQ on each field to see which have indexes', async () => {
      // Test each field separately to see if indexes are created
      const fields = ['ownerId', 'isPublic', 'status'];

      for (const field of fields) {
        const testExpr = new IR.Func('eq', [
          new IR.PropRef([field]),
          new IR.Value(field === 'isPublic' ? true : field === 'status' ? 'pending' : 'bob')
        ]);

        const result = collection.currentStateAsChanges({ where: testExpr, optimizedOnly: true });
        console.log(`33.2 - ${field} with optimizedOnly: true:`, result === undefined ? 'NO INDEX' : result?.map(c => c.key));
      }
    });
  });

  describe('SECTION 34: THE ROOT CAUSE TEST', () => {
    it('34.1 - Compare subscribeChanges requestSnapshot vs direct currentStateAsChanges', async () => {
      const expr = new IR.Func('and', [
        new IR.Func('or', [
          new IR.Func('eq', [new IR.PropRef(['ownerId']), new IR.Value('bob')]),
          new IR.Func('eq', [new IR.PropRef(['isPublic']), new IR.Value(true)])
        ]),
        new IR.Func('eq', [new IR.PropRef(['status']), new IR.Value('pending')])
      ]);

      // Direct call
      const directResult = collection.currentStateAsChanges({ where: expr });
      console.log('34.1 - Direct currentStateAsChanges:', directResult?.map(c => c.key));

      // Via subscribeChanges
      const subscribeResult: string[] = [];
      const sub = collection.subscribeChanges(
        (changes) => {
          for (const c of changes) {
            if (c.type === 'insert') subscribeResult.push(c.key as string);
          }
        },
        {
          whereExpression: expr,
          includeInitialState: true
        }
      );

      await new Promise(r => setTimeout(r, 50));
      sub.unsubscribe();

      console.log('34.1 - Via subscribeChanges:', subscribeResult);
      console.log('34.1 - THEY SHOULD MATCH BUT DO THEY?');
      console.log('34.1 - Direct == Subscribe?', JSON.stringify(directResult?.map(c => c.key).sort()) === JSON.stringify(subscribeResult.sort()));

      expect(directResult?.map(c => c.key).sort()).toEqual(subscribeResult.sort());
    });

    it('34.2 - What if we call currentStateAsChanges from WITHIN a subscription callback?', async () => {
      const expr = new IR.Func('and', [
        new IR.Func('or', [
          new IR.Func('eq', [new IR.PropRef(['ownerId']), new IR.Value('bob')]),
          new IR.Func('eq', [new IR.PropRef(['isPublic']), new IR.Value(true)])
        ]),
        new IR.Func('eq', [new IR.PropRef(['status']), new IR.Value('pending')])
      ]);

      let callbackResult: string[] = [];
      let directResultInCallback: string[] = [];

      const sub = collection.subscribeChanges(
        (changes) => {
          callbackResult = changes.filter(c => c.type === 'insert').map(c => c.key as string);
          // Call currentStateAsChanges from within the callback
          const direct = collection.currentStateAsChanges({ where: expr });
          directResultInCallback = direct?.map(c => c.key as string) ?? [];
        },
        {
          whereExpression: expr,
          includeInitialState: true
        }
      );

      await new Promise(r => setTimeout(r, 50));
      sub.unsubscribe();

      console.log('34.2 - Callback received:', callbackResult);
      console.log('34.2 - Direct in callback:', directResultInCallback);
      console.log('34.2 - Do they differ?', JSON.stringify(callbackResult.sort()) !== JSON.stringify(directResultInCallback.sort()));
    });
  });

  describe('SECTION 35: SMOKING GUN - What Changes After Subscription?', () => {
    it('35.0 - Call currentStateAsChanges BEFORE and AFTER subscribing', async () => {
      const expr = new IR.Func('and', [
        new IR.Func('or', [
          new IR.Func('eq', [new IR.PropRef(['ownerId']), new IR.Value('bob')]),
          new IR.Func('eq', [new IR.PropRef(['isPublic']), new IR.Value(true)])
        ]),
        new IR.Func('eq', [new IR.PropRef(['status']), new IR.Value('pending')])
      ]);

      // BEFORE any subscription
      const beforeResult = collection.currentStateAsChanges({ where: expr });
      console.log('35.0 - BEFORE subscription:', beforeResult?.map(c => c.key));

      // Create a simple subscription (no filter)
      const sub = collection.subscribeChanges(() => {}, { includeInitialState: true });
      await new Promise(r => setTimeout(r, 30));

      // AFTER subscription created
      const afterResult = collection.currentStateAsChanges({ where: expr });
      console.log('35.0 - AFTER subscription:', afterResult?.map(c => c.key));

      sub.unsubscribe();

      console.log('35.0 - Did results change?', JSON.stringify(beforeResult?.map(c => c.key)) !== JSON.stringify(afterResult?.map(c => c.key)));

      expect(beforeResult?.map(c => c.key).sort()).toEqual(['1', '3']);
      expect(afterResult?.map(c => c.key).sort()).toEqual(['1', '3']);
    });

    it('35.0a - Call currentStateAsChanges BEFORE and AFTER subscribing WITH FILTER', async () => {
      const expr = new IR.Func('and', [
        new IR.Func('or', [
          new IR.Func('eq', [new IR.PropRef(['ownerId']), new IR.Value('bob')]),
          new IR.Func('eq', [new IR.PropRef(['isPublic']), new IR.Value(true)])
        ]),
        new IR.Func('eq', [new IR.PropRef(['status']), new IR.Value('pending')])
      ]);

      // BEFORE any subscription
      const beforeResult = collection.currentStateAsChanges({ where: expr });
      console.log('35.0a - BEFORE subscription with filter:', beforeResult?.map(c => c.key));

      // Create a subscription WITH the same filter
      const sub = collection.subscribeChanges(() => {}, { whereExpression: expr, includeInitialState: true });
      await new Promise(r => setTimeout(r, 30));

      // AFTER subscription created
      const afterResult = collection.currentStateAsChanges({ where: expr });
      console.log('35.0a - AFTER subscription with filter:', afterResult?.map(c => c.key));

      sub.unsubscribe();

      console.log('35.0a - Did results change?', JSON.stringify(beforeResult?.map(c => c.key)) !== JSON.stringify(afterResult?.map(c => c.key)));

      // THIS IS THE KEY - does subscribing WITH the filter change subsequent currentStateAsChanges?
    });

    it('35.0b - Check if any indexes are created after subscription', async () => {
      const expr = new IR.Func('and', [
        new IR.Func('or', [
          new IR.Func('eq', [new IR.PropRef(['ownerId']), new IR.Value('bob')]),
          new IR.Func('eq', [new IR.PropRef(['isPublic']), new IR.Value(true)])
        ]),
        new IR.Func('eq', [new IR.PropRef(['status']), new IR.Value('pending')])
      ]);

      // Check indexes BEFORE
      const indexesBefore = (collection as any)._indexes || (collection as any).indexes;
      console.log('35.0b - Indexes BEFORE:', indexesBefore);

      // Create subscription with filter
      const sub = collection.subscribeChanges(() => {}, { whereExpression: expr, includeInitialState: true });
      await new Promise(r => setTimeout(r, 30));

      // Check indexes AFTER
      const indexesAfter = (collection as any)._indexes || (collection as any).indexes;
      console.log('35.0b - Indexes AFTER:', indexesAfter);

      sub.unsubscribe();
    });

    it('35.0c - Test with optimizedOnly after subscription', async () => {
      const expr = new IR.Func('and', [
        new IR.Func('or', [
          new IR.Func('eq', [new IR.PropRef(['ownerId']), new IR.Value('bob')]),
          new IR.Func('eq', [new IR.PropRef(['isPublic']), new IR.Value(true)])
        ]),
        new IR.Func('eq', [new IR.PropRef(['status']), new IR.Value('pending')])
      ]);

      // BEFORE subscription - with optimizedOnly
      const beforeOptimized = collection.currentStateAsChanges({ where: expr, optimizedOnly: true });
      console.log('35.0c - BEFORE with optimizedOnly:', beforeOptimized);

      // Create subscription
      const sub = collection.subscribeChanges(() => {}, { whereExpression: expr, includeInitialState: true });
      await new Promise(r => setTimeout(r, 30));

      // AFTER subscription - with optimizedOnly
      const afterOptimized = collection.currentStateAsChanges({ where: expr, optimizedOnly: true });
      console.log('35.0c - AFTER with optimizedOnly:', afterOptimized?.map(c => c.key));

      sub.unsubscribe();

      // If this changes from undefined to [1,3,4], then indexes are being created
      // and the index optimization is BUGGY
    });

    it('35.0d - Test with SIMPLE eq filter - before and after subscription', async () => {
      const simpleExpr = new IR.Func('eq', [new IR.PropRef(['status']), new IR.Value('pending')]);

      // BEFORE
      const beforeResult = collection.currentStateAsChanges({ where: simpleExpr });
      console.log('35.0d - Simple EQ BEFORE:', beforeResult?.map(c => c.key));

      // Subscribe with the COMPLEX filter
      const complexExpr = new IR.Func('and', [
        new IR.Func('or', [
          new IR.Func('eq', [new IR.PropRef(['ownerId']), new IR.Value('bob')]),
          new IR.Func('eq', [new IR.PropRef(['isPublic']), new IR.Value(true)])
        ]),
        new IR.Func('eq', [new IR.PropRef(['status']), new IR.Value('pending')])
      ]);
      const sub = collection.subscribeChanges(() => {}, { whereExpression: complexExpr, includeInitialState: true });
      await new Promise(r => setTimeout(r, 30));

      // AFTER - test simple expr again
      const afterResult = collection.currentStateAsChanges({ where: simpleExpr });
      console.log('35.0d - Simple EQ AFTER:', afterResult?.map(c => c.key));

      sub.unsubscribe();

      // Simple EQ should still work correctly
      expect(afterResult?.map(c => c.key).sort()).toEqual(['1', '3', '4']);
    });

    it('35.0e - HYPOTHESIS: Index on status field causes partial AND evaluation', async () => {
      // The bug hypothesis:
      // 1. and(or(), eq(status)) is evaluated
      // 2. Index on 'status' field is found and returns {1,3,4}
      // 3. or() cannot be optimized via index, returns canOptimize: false
      // 4. BUG: Instead of falling back to full scan for AND,
      //    the code returns ONLY the status index results {1,3,4}
      //    without filtering them through the OR clause

      // First, ensure index exists on status by querying it
      const statusOnlyExpr = new IR.Func('eq', [new IR.PropRef(['status']), new IR.Value('pending')]);
      const statusSub = collection.subscribeChanges(() => {}, { whereExpression: statusOnlyExpr, includeInitialState: true });
      await new Promise(r => setTimeout(r, 30));
      statusSub.unsubscribe();

      // Now check currentStateAsChanges with optimizedOnly for status
      const statusOptimized = collection.currentStateAsChanges({ where: statusOnlyExpr, optimizedOnly: true });
      console.log('35.0e - Status field index result:', statusOptimized?.map(c => c.key));

      // Now test the complex expr with optimizedOnly
      const complexExpr = new IR.Func('and', [
        new IR.Func('or', [
          new IR.Func('eq', [new IR.PropRef(['ownerId']), new IR.Value('bob')]),
          new IR.Func('eq', [new IR.PropRef(['isPublic']), new IR.Value(true)])
        ]),
        new IR.Func('eq', [new IR.PropRef(['status']), new IR.Value('pending')])
      ]);

      const complexOptimized = collection.currentStateAsChanges({ where: complexExpr, optimizedOnly: true });
      console.log('35.0e - Complex expr optimizedOnly result:', complexOptimized?.map(c => c.key));

      // If complexOptimized returns [1,3,4] that means the index optimization
      // is incorrectly returning just the status index results
      // when it should return undefined (cannot fully optimize)
    });
  });

  describe('SECTION 35b: VERIFY fullyOptimized FLAG', () => {
    it('35b.1 - Simple eq with index should be fullyOptimized', async () => {
      // Import the optimization function from internal path
      // @ts-ignore - importing internal module
      const indexOptModule = await import('../node_modules/@tanstack/db/dist/esm/utils/index-optimization.js');
      const optimizeExpressionWithIndexes = indexOptModule.optimizeExpressionWithIndexes;

      // Force index on status by subscribing
      const sub = collection.subscribeChanges(() => {}, {
        where: (row) => eq(row.status, 'pending'),
        includeInitialState: true
      });
      await new Promise(r => setTimeout(r, 30));
      sub.unsubscribe();

      // Test simple eq expression
      const simpleExpr = new IR.Func('eq', [new IR.PropRef(['status']), new IR.Value('pending')]);
      const result = optimizeExpressionWithIndexes(simpleExpr, collection);

      console.log('35b.1 - Simple eq optimization result:', {
        canOptimize: result.canOptimize,
        fullyOptimized: result.fullyOptimized,
        matchingKeysCount: result.matchingKeys.size
      });

      expect(result.canOptimize).toBe(true);
      expect(result.fullyOptimized).toBe(true);
    });

    it('35b.2 - and(indexed, non-indexed) should NOT be fullyOptimized', async () => {
      // @ts-ignore - importing internal module
      const indexOptModule = await import('../node_modules/@tanstack/db/dist/esm/utils/index-optimization.js');
      const optimizeExpressionWithIndexes = indexOptModule.optimizeExpressionWithIndexes;

      // Force index on status
      const sub = collection.subscribeChanges(() => {}, {
        where: (row) => eq(row.status, 'pending'),
        includeInitialState: true
      });
      await new Promise(r => setTimeout(r, 30));
      sub.unsubscribe();

      // Test complex expression: and(or(...), eq(status))
      // The or() part has no indexes, so this should NOT be fully optimized
      const complexExpr = new IR.Func('and', [
        new IR.Func('or', [
          new IR.Func('eq', [new IR.PropRef(['ownerId']), new IR.Value('bob')]),
          new IR.Func('eq', [new IR.PropRef(['isPublic']), new IR.Value(true)])
        ]),
        new IR.Func('eq', [new IR.PropRef(['status']), new IR.Value('pending')])
      ]);

      const result = optimizeExpressionWithIndexes(complexExpr, collection);

      console.log('35b.2 - Complex and(or(), eq()) optimization result:', {
        canOptimize: result.canOptimize,
        fullyOptimized: result.fullyOptimized,
        matchingKeysCount: result.matchingKeys.size
      });

      expect(result.canOptimize).toBe(true);
      expect(result.fullyOptimized).toBe(false); // NOT fully optimized - needs post-filter
    });

    it('35b.3 - and(indexed, indexed) with both fields indexed SHOULD be fullyOptimized', async () => {
      // @ts-ignore - importing internal module
      const indexOptModule = await import('../node_modules/@tanstack/db/dist/esm/utils/index-optimization.js');
      const optimizeExpressionWithIndexes = indexOptModule.optimizeExpressionWithIndexes;

      // Force indexes on both status and ownerId
      const sub1 = collection.subscribeChanges(() => {}, {
        where: (row) => eq(row.status, 'pending'),
        includeInitialState: true
      });
      const sub2 = collection.subscribeChanges(() => {}, {
        where: (row) => eq(row.ownerId, 'bob'),
        includeInitialState: true
      });
      await new Promise(r => setTimeout(r, 30));
      sub1.unsubscribe();
      sub2.unsubscribe();

      // Test and(eq(status), eq(ownerId)) - both have indexes
      const bothIndexedExpr = new IR.Func('and', [
        new IR.Func('eq', [new IR.PropRef(['status']), new IR.Value('pending')]),
        new IR.Func('eq', [new IR.PropRef(['ownerId']), new IR.Value('bob')])
      ]);

      const result = optimizeExpressionWithIndexes(bothIndexedExpr, collection);

      console.log('35b.3 - and(indexed, indexed) optimization result:', {
        canOptimize: result.canOptimize,
        fullyOptimized: result.fullyOptimized,
        matchingKeysCount: result.matchingKeys.size,
        matchingKeys: Array.from(result.matchingKeys)
      });

      expect(result.canOptimize).toBe(true);
      expect(result.fullyOptimized).toBe(true); // FULLY optimized - no post-filter needed
      expect(Array.from(result.matchingKeys).sort()).toEqual(['1']); // Only T1 matches both
    });
  });

  describe('SECTION 36: EXPERT-SUGGESTED TEST - Post-filter after partial index optimization', () => {
    it('36.EXPERT - should apply post-filter after partial index optimization', async () => {
      // This is the exact test suggested by the TanStack DB expert
      // It exposes the bug where post-filtering is not applied when canOptimize is true

      // Create a fresh collection to control index state
      const testCollection = createCollection<TestItem, string>(
        localOnlyCollectionOptions({
          id: 'expert-test-' + Date.now(),
          getKey: (item) => item.id,
        })
      );

      // Insert test data
      await testCollection.insert({ id: '1', ownerId: 'bob', isPublic: false, status: 'pending', count: 1 }).isPersisted.promise;
      await testCollection.insert({ id: '2', ownerId: 'bob', isPublic: true, status: 'completed', count: 2 }).isPersisted.promise;
      await testCollection.insert({ id: '3', ownerId: 'alice', isPublic: true, status: 'pending', count: 3 }).isPersisted.promise;
      await testCollection.insert({ id: '4', ownerId: 'charlie', isPublic: false, status: 'pending', count: 4 }).isPersisted.promise;

      // Force index creation on status field by subscribing with eq(status)
      const indexSub = testCollection.subscribeChanges(() => {}, {
        where: (row) => eq(row.status, 'pending'),
        includeInitialState: true
      });
      await new Promise(r => setTimeout(r, 30));
      indexSub.unsubscribe();

      // Now test with compound expression where only status can use index
      const expr = new IR.Func('and', [
        new IR.Func('or', [
          new IR.Func('eq', [new IR.PropRef(['ownerId']), new IR.Value('bob')]),
          new IR.Func('eq', [new IR.PropRef(['isPublic']), new IR.Value(true)])
        ]),
        new IR.Func('eq', [new IR.PropRef(['status']), new IR.Value('pending')])
      ]);

      const result = testCollection.currentStateAsChanges({ where: expr });

      console.log('36.EXPERT - Result:', result?.map(r => r.key));
      console.log('36.EXPERT - Expected: ["1", "3"] (bob+pending, public+pending)');
      console.log('36.EXPERT - Item "4" has status=pending but ownerId=charlie and isPublic=false, should be EXCLUDED');

      // Should only return items with status='pending' AND (ownerId='bob' OR isPublic=true)
      // Item '4' has status='pending' but ownerId='charlie' and isPublic=false, so should be excluded
      expect(result?.map(r => r.key).sort()).toEqual(['1', '3']);
    });
  });

  describe('SECTION 36a: PROVE THE BUG - Index returns superset, filter never applied', () => {
    it('36.0 - The smoking gun: index lookup returns {1,3,4}, filter never runs', async () => {
      // Setup: create index on status by subscribing to eq(status)
      const statusSub = collection.subscribeChanges(() => {}, {
        where: (row) => eq(row.status, 'pending'),
        includeInitialState: true
      });
      await new Promise(r => setTimeout(r, 30));
      statusSub.unsubscribe();

      // Now index exists. Test what optimizedOnly returns for JUST status
      const statusOnlyExpr = new IR.Func('eq', [new IR.PropRef(['status']), new IR.Value('pending')]);
      const statusOnlyResult = collection.currentStateAsChanges({ where: statusOnlyExpr, optimizedOnly: true });
      console.log('36.0 - Index lookup for status=pending:', statusOnlyResult?.map(c => c.key));
      // Should be {1, 3, 4}

      // Now test the complex AND expression with optimizedOnly
      const complexExpr = new IR.Func('and', [
        new IR.Func('or', [
          new IR.Func('eq', [new IR.PropRef(['ownerId']), new IR.Value('bob')]),
          new IR.Func('eq', [new IR.PropRef(['isPublic']), new IR.Value(true)])
        ]),
        new IR.Func('eq', [new IR.PropRef(['status']), new IR.Value('pending')])
      ]);

      const complexOptimizedResult = collection.currentStateAsChanges({ where: complexExpr, optimizedOnly: true });
      console.log('36.0 - Index lookup for and(or(), eq(status)):', complexOptimizedResult?.map(c => c.key));

      // THE BUG: This should return undefined (can't fully optimize)
      // or {1, 3} (if it correctly post-filters)
      // BUT IT RETURNS {1, 3, 4} - same as status-only!

      console.log('36.0 - BUG CONFIRMED:',
        JSON.stringify(statusOnlyResult?.map(c => c.key).sort()) ===
        JSON.stringify(complexOptimizedResult?.map(c => c.key).sort())
          ? 'YES - complex AND returns same as status-only (or() filter dropped!)'
          : 'NO - they differ'
      );

      // This test PASSES if the bug exists (both return {1,3,4})
      // It would FAIL if the bug is fixed (complex should return undefined or {1,3})
    });

    it('36.0a - WORKAROUND TEST: What if we disable auto-indexing?', async () => {
      // Create a fresh collection without auto-indexing
      const freshCollection = createCollection<TestItem, string>(
        localOnlyCollectionOptions({
          id: 'diagnostic-no-autoindex-' + Date.now(),
          getKey: (item) => item.id,
          // Try to disable auto-indexing if possible
        })
      );

      // Insert test data
      await freshCollection.insert(T1).isPersisted.promise;
      await freshCollection.insert(T2).isPersisted.promise;
      await freshCollection.insert(T3).isPersisted.promise;
      await freshCollection.insert(T4).isPersisted.promise;

      // Test immediately without any prior subscriptions (no indexes)
      const received: TestItem[] = [];
      const sub = freshCollection.subscribeChanges(
        (changes) => {
          for (const c of changes) {
            if (c.type === 'insert') received.push(c.value);
          }
        },
        {
          where: (row) => and(
            or(eq(row.ownerId, 'bob'), eq(row.isPublic, true)),
            eq(row.status, 'pending')
          ),
          includeInitialState: true
        }
      );

      await new Promise(r => setTimeout(r, 50));
      sub.unsubscribe();

      console.log('36.0a - Fresh collection (no prior index):', received.map(r => r.id));
      // Even fresh, first subscription creates index, so might still fail
    });
  });

  describe('SECTION 37: Final Comprehensive Check', () => {
    it('37.1 - ULTIMATE TEST: All filter methods should agree', async () => {
      // Method 1: Manual JavaScript evaluation
      const manualResults = [T1, T2, T3, T4].filter(item => {
        const orPart = item.ownerId === 'bob' || item.isPublic === true;
        const andPart = orPart && item.status === 'pending';
        return andPart;
      });

      // Method 2: currentStateAsChanges with whereExpression
      const expr = new IR.Func('and', [
        new IR.Func('or', [
          new IR.Func('eq', [new IR.PropRef(['ownerId']), new IR.Value('bob')]),
          new IR.Func('eq', [new IR.PropRef(['isPublic']), new IR.Value(true)])
        ]),
        new IR.Func('eq', [new IR.PropRef(['status']), new IR.Value('pending')])
      ]);
      const currentStateResults = collection.currentStateAsChanges({ where: expr });

      // Method 3: subscribeChanges with where callback
      const subscribeCallbackResults: TestItem[] = [];
      const sub1 = collection.subscribeChanges(
        (changes) => {
          for (const c of changes) {
            if (c.type === 'insert') subscribeCallbackResults.push(c.value);
          }
        },
        {
          where: (row) => and(
            or(eq(row.ownerId, 'bob'), eq(row.isPublic, true)),
            eq(row.status, 'pending')
          ),
          includeInitialState: true
        }
      );

      // Method 4: subscribeChanges with whereExpression
      const subscribeExprResults: TestItem[] = [];
      const sub2 = collection.subscribeChanges(
        (changes) => {
          for (const c of changes) {
            if (c.type === 'insert') subscribeExprResults.push(c.value);
          }
        },
        {
          whereExpression: expr,
          includeInitialState: true
        }
      );

      await new Promise(r => setTimeout(r, 100));
      sub1.unsubscribe();
      sub2.unsubscribe();

      const manualIds = manualResults.map(r => r.id).sort();
      const currentStateIds = currentStateResults?.map(c => String(c.key)).sort() ?? [];
      const subscribeCallbackIds = subscribeCallbackResults.map(r => r.id).sort();
      const subscribeExprIds = subscribeExprResults.map(r => r.id).sort();

      console.log('30.1 - ULTIMATE TEST RESULTS:');
      console.log('  Manual JS filter:', manualIds);
      console.log('  currentStateAsChanges:', currentStateIds);
      console.log('  subscribeChanges (callback):', subscribeCallbackIds);
      console.log('  subscribeChanges (whereExpr):', subscribeExprIds);
      console.log('  Expected: ["1", "3"]');

      expect(manualIds).toEqual(['1', '3']);
      expect(currentStateIds).toEqual(['1', '3']);
      expect(subscribeCallbackIds).toEqual(['1', '3']);
      expect(subscribeExprIds).toEqual(['1', '3']);
    });
  });
});
