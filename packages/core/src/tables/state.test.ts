import { describe, expect, it } from 'vitest';
import type { Operation } from '../orders/operations';
import { foldOperations } from '../orders/reducer';
import { beer, CONTEXT, Device, freshId, line, TABLE, TERMINAL, USER } from '../orders/test-kit';
import { orderTableState, tableStateOf, tableViews } from './state';

/** Folds the operations and returns the table state of one order. */
function stateOf(ops: Operation[], orderId: string) {
  const state = foldOperations(ops, CONTEXT);
  return orderTableState(state, state.orders.get(orderId)!);
}

describe('orderTableState (RF-C01, PA-05)', () => {
  it('an order without items is awaiting its order', () => {
    const d = new Device(TERMINAL.H1);
    const open = d.open();
    expect(stateOf([open], open.orderId)).toBe('awaiting_order');
  });

  it('only pending items: still awaiting the order', () => {
    const d = new Device(TERMINAL.H1);
    const open = d.open();
    expect(stateOf([open, d.add(open.orderId, line(), beer())], open.orderId)).toBe(
      'awaiting_order',
    );
  });

  it('something sent to the kitchen: in kitchen', () => {
    const d = new Device(TERMINAL.H1);
    const open = d.open();
    const food = line();
    const drink = beer();
    const ops: Operation[] = [
      open,
      d.add(open.orderId, food, drink),
      d.send(open.orderId, food.itemId),
    ];
    expect(stateOf(ops, open.orderId)).toBe('in_kitchen');
    // Drinks served while the food is cooking: still in kitchen.
    ops.push(d.serve(open.orderId, drink.itemId));
    expect(stateOf(ops, open.orderId)).toBe('in_kitchen');
  });

  it('everything served and something to pay: awaiting payment', () => {
    const d = new Device(TERMINAL.H1);
    const open = d.open();
    const food = line();
    const ops: Operation[] = [
      open,
      d.add(open.orderId, food),
      d.send(open.orderId, food.itemId),
      d.serve(open.orderId, food.itemId),
    ];
    expect(stateOf(ops, open.orderId)).toBe('awaiting_payment');
    // A partial payment leaves a balance: still awaiting payment.
    ops.push(d.pay(open.orderId, 1000));
    expect(stateOf(ops, open.orderId)).toBe('awaiting_payment');
  });

  it('some courses served and the next one not sent yet: occupied', () => {
    const d = new Device(TERMINAL.H1);
    const open = d.open();
    const starter = line({ course: 1 });
    const main = line({ course: 2 });
    const ops = [
      open,
      d.add(open.orderId, starter, main),
      d.send(open.orderId, starter.itemId),
      d.serve(open.orderId, starter.itemId),
    ];
    expect(stateOf(ops, open.orderId)).toBe('occupied');
  });

  it('everything served and paid but reopened: occupied, nothing to collect', () => {
    const d = new Device(TERMINAL.K1, USER.manager);
    const open = d.open();
    const food = line();
    const ops = [
      open,
      d.add(open.orderId, food),
      d.serve(open.orderId, food.itemId),
      d.pay(open.orderId, 2450),
      d.op('order.reopen', open.orderId, { reason: 'Falsch abgerechnet' }),
    ];
    const state = foldOperations(ops, CONTEXT);
    const order = state.orders.get(open.orderId)!;
    expect(order).toMatchObject({ status: 'open', balanceRappen: 0 });
    expect(orderTableState(state, order)).toBe('occupied');
  });

  it('ignores voided items', () => {
    const d = new Device(TERMINAL.H1);
    const open = d.open();
    const served = line();
    const wrong = beer();
    const ops = [
      open,
      d.add(open.orderId, served, wrong),
      d.serve(open.orderId, served.itemId),
      d.op('item.void', open.orderId, {
        itemId: wrong.itemId,
        quantity: 1,
        voidedItemId: freshId(),
        reason: 'entry_error',
        reasonText: null,
      }),
    ];
    // Without the voided beer everything is served and the Rösti is still to pay.
    expect(stateOf(ops, open.orderId)).toBe('awaiting_payment');
  });

  it('an item ready at the pass wins over everything (KDS, Phase 3)', () => {
    const d = new Device(TERMINAL.H1);
    const open = d.open();
    const food = line();
    const drink = beer();
    const state = foldOperations(
      [open, d.add(open.orderId, food, drink), d.send(open.orderId, food.itemId, drink.itemId)],
      CONTEXT,
    );
    // No operation sets "ready" yet; the KDS will. The state function already honours it.
    state.items.get(food.itemId)!.prepStatus = 'ready';
    expect(orderTableState(state, state.orders.get(open.orderId)!)).toBe('ready');
  });
});

describe('tableViews (RF-C01, RF-C03, RF-C05, RF-C19)', () => {
  it('a table without an open order is free', () => {
    const views = tableViews(foldOperations([], CONTEXT));
    expect(views.size).toBe(0);
    expect(tableStateOf(views, TABLE.t1)).toBe('free');
  });

  it('closed, voided and table-less orders free nothing and occupy nothing', () => {
    const d = new Device(TERMINAL.K1, USER.manager);
    const closed = d.open(freshId(), { tableId: TABLE.t1 });
    const voided = d.open(freshId(), { tableId: TABLE.t2 }, 2);
    const takeaway = d.open(
      freshId(),
      { channel: 'takeaway', consumptionType: 'takeaway', tableId: null },
      3,
    );
    const food = line();
    const views = tableViews(
      foldOperations(
        [
          closed,
          d.add(closed.orderId, food),
          d.serve(closed.orderId, food.itemId),
          d.pay(closed.orderId, 2450),
          voided,
          d.op('order.void', voided.orderId, { reason: 'guest_changed_mind', reasonText: null }),
          takeaway,
          d.add(takeaway.orderId, line()),
        ],
        CONTEXT,
      ),
    );
    expect(views.size).toBe(0);
    expect(tableStateOf(views, TABLE.t1)).toBe('free');
    expect(tableStateOf(views, TABLE.t2)).toBe('free');
  });

  it('shows the state of the open order on its table', () => {
    const d = new Device(TERMINAL.H1);
    const open = d.open(freshId(), { tableId: TABLE.t2 });
    const food = line();
    const add = d.add(open.orderId, food);
    const send = d.send(open.orderId, food.itemId);
    const views = tableViews(foldOperations([open, add, send], CONTEXT));
    expect(views.get(TABLE.t2)).toEqual({
      state: 'in_kitchen',
      orderIds: [open.orderId],
      openedAt: open.deviceAt,
      lastSentAt: send.deviceAt,
      joinedToTableId: null,
    });
    expect(tableStateOf(views, TABLE.t1)).toBe('free');
  });

  it('with two orders on a table, what needs attention first wins (RF-C05)', () => {
    const d = new Device(TERMINAL.H1);
    const first = d.open(freshId(), { tableId: TABLE.t1 }, 1);
    const second = d.open(freshId(), { tableId: TABLE.t1 }, 2);
    const done = line();
    const cooking = beer();
    const base = [
      first,
      second,
      d.add(first.orderId, done),
      d.serve(first.orderId, done.itemId), // first: served, not paid
      d.add(second.orderId, cooking),
      d.send(second.orderId, cooking.itemId), // second: in kitchen
    ];
    let views = tableViews(foldOperations(base, CONTEXT));
    expect(views.get(TABLE.t1)!.state).toBe('awaiting_payment');
    expect(views.get(TABLE.t1)!.orderIds.sort()).toEqual([first.orderId, second.orderId].sort());

    // A group that has not ordered yet beats one waiting for the kitchen.
    const third = d.open(freshId(), { tableId: TABLE.t2 }, 3);
    const fourth = d.open(freshId(), { tableId: TABLE.t2 }, 4);
    const food = line();
    views = tableViews(
      foldOperations(
        [...base, third, fourth, d.add(third.orderId, food), d.send(third.orderId, food.itemId)],
        CONTEXT,
      ),
    );
    expect(views.get(TABLE.t2)!.state).toBe('awaiting_order');
  });

  it('takes the earliest opening and the latest kitchen send of its orders (RF-C19)', () => {
    const d = new Device(TERMINAL.H1);
    // Operations are created in the order they happen: each one ticks the device clock.
    const first = d.open(freshId(), { tableId: TABLE.t1 }, 1);
    const firstItem = line();
    const firstAdd = d.add(first.orderId, firstItem);
    const firstSend = d.wait(60_000).send(first.orderId, firstItem.itemId);
    const second = d.wait(60_000).open(freshId(), { tableId: TABLE.t1 }, 2);
    const secondItem = line();
    const secondAdd = d.add(second.orderId, secondItem);
    const secondSend = d.wait(60_000).send(second.orderId, secondItem.itemId);
    const view = tableViews(
      foldOperations([first, firstAdd, firstSend, second, secondAdd, secondSend], CONTEXT),
    ).get(TABLE.t1)!;
    expect(view.openedAt).toBe(first.deviceAt);
    expect(view.lastSentAt).toBe(secondSend.deviceAt);
    expect(firstSend.deviceAt < secondSend.deviceAt).toBe(true);
  });

  it('has no last send while nothing went to the kitchen', () => {
    const d = new Device(TERMINAL.H1);
    const open = d.open();
    const view = tableViews(foldOperations([open, d.add(open.orderId, line())], CONTEXT)).get(
      TABLE.t1,
    )!;
    expect(view.lastSentAt).toBeNull();
    expect(view.openedAt).toBe(open.deviceAt);
  });

  describe('joined tables (RF-C03)', () => {
    it('show the same state and point to the main table', () => {
      const d = new Device(TERMINAL.H1);
      const open = d.open(freshId(), { tableId: TABLE.t1 });
      const food = line();
      const views = tableViews(
        foldOperations(
          [
            open,
            d.op('order.update', open.orderId, { joinedTableIds: [TABLE.t2, TABLE.t3] }),
            d.add(open.orderId, food),
            d.send(open.orderId, food.itemId),
          ],
          CONTEXT,
        ),
      );
      expect(views.get(TABLE.t1)).toMatchObject({ state: 'in_kitchen', joinedToTableId: null });
      for (const tableId of [TABLE.t2, TABLE.t3]) {
        expect(views.get(tableId)).toMatchObject({
          state: 'in_kitchen',
          orderIds: [open.orderId],
          joinedToTableId: TABLE.t1,
        });
      }
    });

    it('never count the main table twice', () => {
      const d = new Device(TERMINAL.H1);
      const open = d.open(freshId(), { tableId: TABLE.t1 });
      const views = tableViews(
        foldOperations(
          [open, d.op('order.update', open.orderId, { joinedTableIds: [TABLE.t1, TABLE.t2] })],
          CONTEXT,
        ),
      );
      expect(views.get(TABLE.t1)!.orderIds).toEqual([open.orderId]);
      expect(views.get(TABLE.t1)!.joinedToTableId).toBeNull();
      expect(views.get(TABLE.t2)!.joinedToTableId).toBe(TABLE.t1);
    });

    it('a joined table with its own order shows the most urgent of both', () => {
      const d = new Device(TERMINAL.H1);
      const main = d.open(freshId(), { tableId: TABLE.t1 }, 1);
      const own = d.open(freshId(), { tableId: TABLE.t2 }, 2);
      const served = line();
      const cooking = line();
      const views = tableViews(
        foldOperations(
          [
            main,
            own,
            d.op('order.update', main.orderId, { joinedTableIds: [TABLE.t2] }),
            d.add(main.orderId, served),
            d.serve(main.orderId, served.itemId),
            d.add(own.orderId, cooking),
            d.send(own.orderId, cooking.itemId),
          ],
          CONTEXT,
        ),
      );
      expect(views.get(TABLE.t2)).toMatchObject({
        state: 'awaiting_payment',
        joinedToTableId: TABLE.t1,
      });
      expect(views.get(TABLE.t2)!.orderIds.sort()).toEqual([main.orderId, own.orderId].sort());
    });

    it('free the joined tables when the join is undone', () => {
      const d = new Device(TERMINAL.H1);
      const open = d.open(freshId(), { tableId: TABLE.t1 });
      const views = tableViews(
        foldOperations(
          [
            open,
            d.op('order.update', open.orderId, { joinedTableIds: [TABLE.t2] }),
            d.op('order.update', open.orderId, { joinedTableIds: [] }),
          ],
          CONTEXT,
        ),
      );
      expect(tableStateOf(views, TABLE.t2)).toBe('free');
      expect(tableStateOf(views, TABLE.t1)).toBe('awaiting_order');
    });
  });
});
