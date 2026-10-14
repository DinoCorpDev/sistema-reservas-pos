import { describe, expect, it } from 'vitest';
import type { Operation } from '../orders/operations';
import { type FoldContext, foldOperations } from '../orders/reducer';
import { CONTEXT, Device, freshId, line, TERMINAL, USER } from '../orders/test-kit';

const restricted: FoldContext = {
  ...CONTEXT,
  settings: { ...CONTEXT.settings, tableOwnership: 'restricted' },
};
const codesOf = (ops: Operation[], context: FoldContext, opId: string) =>
  foldOperations(ops, context)
    .conflicts.filter((c) => c.opId === opId)
    .map((c) => c.code);

/** Anna opened table 1; Luca, another waiter, comes by. */
function table() {
  const anna = new Device(TERMINAL.H1, USER.waiter);
  const luca = new Device(TERMINAL.H2, USER.waiter2);
  const open = anna.open();
  const first = anna.add(open.orderId, line());
  luca.sees(open, first);
  return { anna, luca, open, ops: [open, first] as Operation[] };
}

describe('who works on a table (DEC-039)', () => {
  it('open (default): any waiter adds, sends and collects at any table', () => {
    const { luca, open, ops } = table();
    const item = line();
    const add = luca.add(open.orderId, item);
    const send = luca.send(open.orderId, item.itemId);
    const state = foldOperations([...ops, add, send], CONTEXT);
    expect(state.conflicts).toEqual([]);
    // The table stays Anna's: her tip, her table on the map.
    expect(state.orders.get(open.orderId)?.waiterUserId).toBe(USER.waiter);
    expect(state.items.get(item.itemId)?.addedByUserId).toBe(USER.waiter2);
  });

  it('restricted: another waiter’s order on the table is recorded and flagged', () => {
    const { luca, open, ops } = table();
    const add = luca.add(open.orderId, line());
    expect(codesOf([...ops, add], restricted, add.id)).toEqual(['not_table_owner']);
    // It happened: the line is there for the manager to settle.
    expect(foldOperations([...ops, add], restricted).items.size).toBe(2);
  });

  it('restricted: the table’s waiter and the till work on it freely', () => {
    const { anna, open, ops } = table();
    const own = anna.add(open.orderId, line());
    expect(codesOf([...ops, own], restricted, own.id)).toEqual([]);
    const till = new Device(TERMINAL.K1, USER.cashier).sees(...ops);
    const cashier = till.add(open.orderId, line());
    expect(codesOf([...ops, cashier], restricted, cashier.id)).toEqual([]);
  });

  it('restricted: bar and take-away orders are shared', () => {
    const anna = new Device(TERMINAL.H1, USER.waiter);
    const luca = new Device(TERMINAL.H2, USER.waiter2);
    const bar = anna.open(freshId(), { channel: 'bar', tableId: null });
    luca.sees(bar);
    const add = luca.add(bar.orderId, line());
    expect(codesOf([bar, add], restricted, add.id)).toEqual([]);
  });

  it('handing the table to another waiter needs a manager or an admin, in both modes', () => {
    const { luca, open, ops } = table();
    const takeOver = luca.op('order.update', open.orderId, { waiterUserId: USER.waiter2 });
    expect(codesOf([...ops, takeOver], CONTEXT, takeOver.id)).toEqual(['approval_invalid']);
    const approved = luca.op(
      'order.update',
      open.orderId,
      { waiterUserId: USER.waiter2 },
      { approval: { approverUserId: USER.manager, permissions: ['order.reassign'] } },
    );
    const state = foldOperations([...ops, approved], restricted);
    expect(state.conflicts).toEqual([]);
    expect(state.orders.get(open.orderId)?.waiterUserId).toBe(USER.waiter2);
    expect(state.audits.filter((a) => a.action === 'order.waiter_changed')).toMatchObject([
      {
        before: { waiterUserId: USER.waiter },
        after: { waiterUserId: USER.waiter2 },
        authorizedByUserId: USER.manager,
      },
    ]);
    // From then on the table is Luca's.
    const add = luca.sees(approved).add(open.orderId, line());
    expect(codesOf([...ops, approved, add], restricted, add.id)).toEqual([]);
  });

  it('other changes of the order (guests, allergies) need no approval', () => {
    const { luca, open, ops } = table();
    const guests = luca.op('order.update', open.orderId, { guestCount: 4 });
    expect(codesOf([...ops, guests], restricted, guests.id)).toEqual([]);
  });
});
