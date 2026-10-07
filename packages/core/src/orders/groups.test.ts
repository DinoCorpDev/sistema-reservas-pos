import { describe, expect, it } from 'vitest';
import { operationsOfGroup, orderGroups } from './groups';
import { orderNumber } from './numbering';
import type { Operation } from './operations';
import { Device, freshId, line, random, shuffle, TABLE, TERMINAL, USER } from './test-kit';

/** Groups as sorted lists, sorted by their first id, so they compare regardless of order. */
const normalize = (groups: string[][]) =>
  groups.map((group) => [...group].sort()).sort((a, b) => (a[0]! < b[0]! ? -1 : 1));

function scenario() {
  const d = new Device(TERMINAL.H1, USER.manager);
  const [a, b, c, e, f] = Array.from({ length: 5 }, () => d.open(freshId(), { tableId: TABLE.t1 }));
  const child = freshId();
  const item = line();
  const ops = {
    opens: [a!, b!, c!, e!, f!],
    addA: d.add(a!.orderId, item),
    addF: d.add(f!.orderId, line()),
    transfer: d.op('items.transfer', a!.orderId, { itemIds: [item.itemId], toOrderId: b!.orderId }),
    split: d.op('order.split', b!.orderId, {
      newOrderId: child,
      itemIds: [item.itemId],
      number: orderNumber('2026-10-06', 6),
    }),
    merge: d.op('order.merge', c!.orderId, { intoOrderId: e!.orderId }),
    unlocked: d.op('terminal.unlocked', null, {}),
    failed: d.op('terminal.pin_failed', null, { attempt: 1 }, { userId: null }),
  };
  const all: Operation[] = [
    ...ops.opens,
    ops.addA,
    ops.addF,
    ops.transfer,
    ops.split,
    ops.merge,
    ops.unlocked,
    ops.failed,
  ];
  return {
    ids: { a: a!.orderId, b: b!.orderId, c: c!.orderId, e: e!.orderId, f: f!.orderId, child },
    ops,
    all,
  };
}

describe('orderGroups (docs/SYNC.md §4)', () => {
  it('links transfers, splits and merges and keeps independent orders apart', () => {
    const { ids, all } = scenario();
    expect(normalize(orderGroups(all))).toEqual(
      normalize([[ids.a, ids.b, ids.child], [ids.c, ids.e], [ids.f]]),
    );
  });

  it('ignores terminal operations: they belong to no order', () => {
    const d = new Device(TERMINAL.H1);
    const ops = [
      d.op('terminal.unlocked', null, {}),
      d.op('terminal.pin_failed', null, { attempt: 3 }, { userId: null }),
    ];
    expect(orderGroups(ops)).toEqual([]);
    expect(orderGroups([])).toEqual([]);
  });

  it('joins chains transitively: a→b, c→x, then b→c makes one group', () => {
    const d = new Device(TERMINAL.H1, USER.manager);
    const [a, b, c, x] = Array.from({ length: 4 }, () => freshId());
    const ops: Operation[] = [
      d.op('items.transfer', a!, { itemIds: [freshId()], toOrderId: b! }),
      d.op('items.transfer', c!, { itemIds: [freshId()], toOrderId: x! }),
    ];
    expect(orderGroups(ops)).toHaveLength(2);
    ops.push(d.op('order.merge', b!, { intoOrderId: c! }));
    expect(normalize(orderGroups(ops))).toEqual([[a!, b!, c!, x!].sort()]);
  });

  it('gives the same groups whatever the order of the operations', () => {
    const { all } = scenario();
    const expected = normalize(orderGroups(all));
    for (let seed = 1; seed <= 20; seed += 1) {
      expect(normalize(orderGroups(shuffle(all, random(seed))))).toEqual(expected);
    }
  });

  it('lists every order exactly once', () => {
    const { ids, all } = scenario();
    const listed = orderGroups(all).flat().sort();
    expect(listed).toEqual(Object.values(ids).sort());
  });
});

describe('operationsOfGroup', () => {
  it('returns the operations that touch any order of the group, in their order', () => {
    const { ids, ops, all } = scenario();
    const group = new Set([ids.a, ids.b, ids.child]);
    const opens = ops.opens.filter((op) => group.has(op.orderId));
    expect(operationsOfGroup(all, group)).toEqual([...opens, ops.addA, ops.transfer, ops.split]);
  });

  it('includes a two-order operation when only its second order is in the group', () => {
    const { ids, ops, all } = scenario();
    expect(operationsOfGroup(all, new Set([ids.e]))).toEqual([
      ops.opens[3],
      ops.merge, // merge c → e
    ]);
  });

  it('never includes terminal operations', () => {
    const { ids, all } = scenario();
    const everything = new Set(Object.values(ids));
    expect(operationsOfGroup(all, everything).map((op) => op.type)).not.toContain(
      'terminal.unlocked',
    );
    expect(operationsOfGroup(all, everything)).toHaveLength(all.length - 2);
  });
});
