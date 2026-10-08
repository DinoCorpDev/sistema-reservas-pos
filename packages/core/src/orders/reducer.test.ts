import { describe, expect, it } from 'vitest';
import { extractTax } from '../tax/calculation';
import type { Operation } from './operations';
import { foldOperations } from './reducer';
import { itemsOf } from './state';
import { beer, CONTEXT, Device, freshId, line, TABLE, TERMINAL, USER } from './test-kit';

const approvalFor = (...permissions: string[]) => ({
  approverUserId: USER.manager,
  permissions: permissions as never[],
});

describe('order lifecycle (RF-C02, RF-C08, RF-C09, RF-C16, RN-12)', () => {
  it('opens, adds, sends, serves and closes only when served AND paid', () => {
    const waiter = new Device(TERMINAL.H1);
    const open = waiter.open();
    const id = open.orderId;
    const rosti = line();
    const beers = beer({ quantity: 2 });
    const add = waiter.add(id, rosti, beers);
    const send = waiter.send(id, rosti.itemId, beers.itemId);
    const serve = waiter.serve(id, rosti.itemId, beers.itemId);

    let state = foldOperations([open, add, send, serve], CONTEXT);
    let order = state.orders.get(id)!;
    expect(order.subtotalRappen).toBe(3750);
    expect(order.totalRappen).toBe(3750);
    expect(order.taxTotalRappen).toBe(
      extractTax(2450 as never, 810) + extractTax(1300 as never, 810),
    );
    expect(order.lastSentAt).toBe(send.deviceAt);
    // Everything served, nothing paid: the kitchen is done, the payment is not (PA-05).
    expect(order.status).toBe('open');
    expect(order.paymentStatus).toBe('unpaid');
    expect(order.balanceRappen).toBe(3750);

    const pay = waiter.pay(id, 3750);
    state = foldOperations([open, add, send, serve, pay], CONTEXT);
    order = state.orders.get(id)!;
    expect(order.paymentStatus).toBe('paid');
    expect(order.status).toBe('closed');
    expect(order.closedAt).toBe(pay.deviceAt);
    expect([...state.outcomes.values()].every((o) => o === 'applied')).toBe(true);
  });

  it('a prepaid order (takeaway, RF-C17) closes when it is handed over', () => {
    const counter = new Device(TERMINAL.K1, USER.cashier);
    const open = counter.open(freshId(), {
      channel: 'takeaway',
      consumptionType: 'takeaway',
      tableId: null,
    });
    const item = line({ taxRateCode: 'reduced', taxRateBp: 260 });
    const ops: Operation[] = [
      open,
      counter.add(open.orderId, item),
      counter.pay(open.orderId, 2450),
    ];
    let state = foldOperations(ops, CONTEXT);
    expect(state.orders.get(open.orderId)).toMatchObject({ status: 'open', paymentStatus: 'paid' });
    ops.push(counter.send(open.orderId, item.itemId), counter.serve(open.orderId, item.itemId));
    state = foldOperations(ops, CONTEXT);
    expect(state.orders.get(open.orderId)!.status).toBe('closed');
  });

  it('partial and mixed payments keep the balance visible (RF-D02)', () => {
    const d = new Device(TERMINAL.K1, USER.cashier);
    const open = d.open();
    const item = line({ quantity: 3 }); // 73.50
    const base = [open, d.add(open.orderId, item), d.serve(open.orderId, item.itemId)];
    const card = d.pay(open.orderId, 5000);
    let order = foldOperations([...base, card], CONTEXT).orders.get(open.orderId)!;
    expect(order).toMatchObject({ paymentStatus: 'partial', balanceRappen: 2350, status: 'open' });
    const cash = d.pay(open.orderId, 2350, {
      method: 'cash',
      adapter: 'cash',
      roundingRappen: 0,
      tenderedRappen: 3000,
      changeRappen: 650,
    });
    order = foldOperations([...base, card, cash], CONTEXT).orders.get(open.orderId)!;
    expect(order).toMatchObject({ paymentStatus: 'paid', balanceRappen: 0, status: 'closed' });
  });

  it('cash rounding and tips stay outside the sale (RN-06, RN-07)', () => {
    const d = new Device(TERMINAL.K1, USER.cashier);
    const open = d.open();
    const item = line({ unitPriceRappen: 3742 });
    const ops = [
      open,
      d.add(open.orderId, item),
      d.serve(open.orderId, item.itemId),
      d.pay(open.orderId, 3742, {
        method: 'cash',
        adapter: 'cash',
        tipRappen: 300,
        tipUserId: USER.waiter,
        roundingRappen: -2,
        tenderedRappen: 5000,
        changeRappen: 960,
      }),
    ];
    const order = foldOperations(ops, CONTEXT).orders.get(open.orderId)!;
    expect(order).toMatchObject({
      totalRappen: 3742,
      paidRappen: 3742,
      tipTotalRappen: 300,
      roundingTotalRappen: -2,
      status: 'closed',
    });
  });

  it('an order without valid items never closes; it is voided (RN-12)', () => {
    const d = new Device(TERMINAL.H1);
    const open = d.open();
    const item = line();
    const ops: Operation[] = [
      open,
      d.add(open.orderId, item),
      d.op('item.void', open.orderId, {
        itemId: item.itemId,
        quantity: 1,
        voidedItemId: freshId(),
        reason: 'entry_error',
        reasonText: null,
      }),
    ];
    let state = foldOperations(ops, CONTEXT);
    expect(state.orders.get(open.orderId)!.status).toBe('open');
    ops.push(d.op('order.void', open.orderId, { reason: 'guest_changed_mind', reasonText: null }));
    state = foldOperations(ops, CONTEXT);
    expect(state.orders.get(open.orderId)).toMatchObject({
      status: 'voided',
      voidReason: 'guest_changed_mind',
    });
    expect(state.audits.map((a) => a.action)).toContain('order.voided');
  });

  it('an order with payments cannot be voided: it is refunded instead (RN-12, RN-14)', () => {
    const d = new Device(TERMINAL.K1, USER.manager);
    const open = d.open();
    const ops = [open, d.add(open.orderId, line()), d.pay(open.orderId, 1000)];
    const voidOp = d.op('order.void', open.orderId, { reason: 'other', reasonText: null });
    const state = foldOperations([...ops, voidOp], CONTEXT);
    expect(state.orders.get(open.orderId)!.status).toBe('open');
    expect(state.outcomes.get(voidOp.id)).toBe('conflict');
    expect(state.conflicts).toContainEqual({
      opId: voidOp.id,
      code: 'order_state',
      entityId: open.orderId,
    });
  });
});

describe('items (RF-C08, RF-C10, RN-11, RN-13)', () => {
  it('changes quantity, note, seat and course only before sending', () => {
    const d = new Device(TERMINAL.H1);
    const open = d.open();
    const item = line();
    const update = (fields: object) =>
      d.op('item.update', open.orderId, { itemId: item.itemId, ...fields });
    const add = d.add(open.orderId, item);
    const before = update({ quantity: 2, note: 'ohne Zwiebeln', seat: 3, course: 2 });
    const send = d.send(open.orderId, item.itemId);
    const after = update({ quantity: 5 });
    const state = foldOperations([open, add, before, send, after], CONTEXT);
    expect(state.items.get(item.itemId)).toMatchObject({
      quantity: 2,
      note: 'ohne Zwiebeln',
      seat: 3,
      course: 2,
      prepStatus: 'sent',
    });
    expect(state.outcomes.get(after.id)).toBe('conflict');
  });

  it('voids part of a quantity as a new line, never deleting anything', () => {
    const d = new Device(TERMINAL.H1, USER.manager);
    const open = d.open();
    const item = line({ quantity: 3 });
    const voidedItemId = freshId();
    const ops = [
      open,
      d.add(open.orderId, item),
      d.send(open.orderId, item.itemId),
      d.op('item.void', open.orderId, {
        itemId: item.itemId,
        quantity: 1,
        voidedItemId,
        reason: 'kitchen_error',
        reasonText: 'angebrannt',
      }),
    ];
    const state = foldOperations(ops, CONTEXT);
    expect(state.items.get(item.itemId)).toMatchObject({ quantity: 2, prepStatus: 'sent' });
    expect(state.items.get(voidedItemId)).toMatchObject({
      quantity: 1,
      prepStatus: 'voided',
      voidReason: 'kitchen_error',
      voidedByUserId: USER.manager,
    });
    expect(itemsOf(state, open.orderId)).toHaveLength(2);
    expect(state.orders.get(open.orderId)!.totalRappen).toBe(4900);
    const audit = state.audits.find((a) => a.action === 'order.item_voided')!;
    expect(audit).toMatchObject({ entityId: item.itemId, reason: 'kitchen_error: angebrannt' });
  });

  it('a waiter voiding a sent item needs a manager approval (RN-15)', () => {
    const d = new Device(TERMINAL.H1, USER.waiter);
    const open = d.open();
    const item = line();
    const base = [open, d.add(open.orderId, item), d.send(open.orderId, item.itemId)];
    const payload = {
      itemId: item.itemId,
      quantity: 1,
      voidedItemId: freshId(),
      reason: 'guest_changed_mind' as const,
      reasonText: null,
    };
    const alone = d.op('item.void', open.orderId, payload);
    let state = foldOperations([...base, alone], CONTEXT);
    // It happened in the room, so it is applied, but the manager sees a conflict.
    expect(state.items.get(item.itemId)!.prepStatus).toBe('voided');
    expect(state.conflicts).toContainEqual({
      opId: alone.id,
      code: 'approval_invalid',
      entityId: USER.waiter,
    });

    const approved = d.op('item.void', open.orderId, payload, {
      approval: approvalFor('order.void_item', 'approval.grant'),
    });
    state = foldOperations([...base, approved], CONTEXT);
    expect(state.outcomes.get(approved.id)).toBe('applied');
    expect(state.items.get(item.itemId)!.voidAuthorizedByUserId).toBe(USER.manager);
    expect(state.audits.find((a) => a.opId === approved.id)!.authorizedByUserId).toBe(USER.manager);
  });

  it('a pending item can be voided by the waiter without approval', () => {
    const d = new Device(TERMINAL.H1, USER.waiter);
    const open = d.open();
    const item = line();
    const add = d.add(open.orderId, item);
    const voidOp = d.op('item.void', open.orderId, {
      itemId: item.itemId,
      quantity: 1,
      voidedItemId: freshId(),
      reason: 'entry_error',
      reasonText: null,
    });
    const state = foldOperations([open, add, voidOp], CONTEXT);
    expect(state.outcomes.get(voidOp.id)).toBe('applied');
  });

  it('an unknown or inactive user is applied but flagged', () => {
    const d = new Device(TERMINAL.H1, USER.inactive);
    const open = d.open();
    const state = foldOperations([open], CONTEXT);
    expect(state.orders.has(open.orderId)).toBe(true);
    expect(state.conflicts).toContainEqual({
      opId: open.id,
      code: 'user_inactive',
      entityId: USER.inactive,
    });
  });
});

describe('discounts (RF-C11, RN-15)', () => {
  it('a percent item discount comes off its line and the MWST is extracted from the rest', () => {
    const d = new Device(TERMINAL.H1);
    const open = d.open();
    const item = line(); // 24.50
    const ops = [
      open,
      d.add(open.orderId, item),
      d.op('discount.apply', open.orderId, {
        discountId: freshId(),
        itemId: item.itemId,
        kind: 'percent',
        value: 1000,
        reasonCode: 'promotion',
        reasonText: null,
      }),
    ];
    const state = foldOperations(ops, CONTEXT);
    const stored = state.items.get(item.itemId)!;
    expect(stored.discountRappen).toBe(245);
    expect(stored.lineTotalRappen).toBe(2205);
    expect(stored.taxRappen).toBe(extractTax(2205 as never, 810));
    expect(state.orders.get(open.orderId)).toMatchObject({
      discountTotalRappen: 245,
      totalRappen: 2205,
    });
  });

  it('an order discount is spread over the lines and adds up exactly', () => {
    const d = new Device(TERMINAL.H1, USER.manager);
    const open = d.open();
    const a = line({ unitPriceRappen: 1000 });
    const b = beer({ unitPriceRappen: 333 });
    const c = line({ unitPriceRappen: 667, taxRateCode: 'reduced', taxRateBp: 260 });
    const discountId = freshId();
    const state = foldOperations(
      [
        open,
        d.add(open.orderId, a, b, c),
        d.op('discount.apply', open.orderId, {
          discountId,
          itemId: null,
          kind: 'amount',
          value: 101,
          reasonCode: 'courtesy',
          reasonText: null,
        }),
      ],
      CONTEXT,
    );
    const lines = [a, b, c].map((l) => state.items.get(l.itemId)!);
    expect(lines.reduce((sum, l) => sum + l.discountRappen, 0)).toBe(101);
    // 101 × (1000, 333, 667) / 2000 = 50.5, 16.82, 33.68 → floors 50, 16, 33 and the two
    // leftover rappen go to the largest remainders (16.82, 33.68).
    expect(lines.map((l) => l.discountRappen)).toEqual([50, 17, 34]);
    expect(state.discounts.get(discountId)!.amountRappen).toBe(101);
    const order = state.orders.get(open.orderId)!;
    expect(order.totalRappen).toBe(2000 - 101);
    expect(order.taxTotalRappen).toBe(lines.reduce((sum, l) => sum + l.taxRappen, 0));
  });

  it('a new discount on the same line replaces the previous one', () => {
    const d = new Device(TERMINAL.H1);
    const open = d.open();
    const item = line();
    const first = freshId();
    const second = freshId();
    const apply = (discountId: string, value: number) =>
      d.op('discount.apply', open.orderId, {
        discountId,
        itemId: item.itemId,
        kind: 'percent',
        value,
        reasonCode: 'promotion',
        reasonText: null,
      });
    const state = foldOperations(
      [open, d.add(open.orderId, item), apply(first, 1000), apply(second, 500)],
      CONTEXT,
    );
    expect(state.discounts.get(first)!.removedAt).not.toBeNull();
    expect(state.items.get(item.itemId)!.discountRappen).toBe(123); // 5 % of 24.50, half up
  });

  it('above 20 % a waiter needs a manager (RN-15), below not', () => {
    const d = new Device(TERMINAL.H1, USER.waiter);
    const open = d.open();
    const item = line();
    const base = [open, d.add(open.orderId, item)];
    const discount = (value: number, approval?: ReturnType<typeof approvalFor>) =>
      d.op(
        'discount.apply',
        open.orderId,
        {
          discountId: freshId(),
          itemId: null,
          kind: 'percent',
          value,
          reasonCode: 'staff',
          reasonText: null,
        },
        approval ? { approval } : {},
      );
    const small = discount(2000);
    const big = discount(5000);
    const approved = discount(5000, approvalFor('order.discount', 'approval.grant'));
    expect(foldOperations([...base, small], CONTEXT).outcomes.get(small.id)).toBe('applied');
    expect(foldOperations([...base, big], CONTEXT).outcomes.get(big.id)).toBe('conflict');
    expect(foldOperations([...base, approved], CONTEXT).outcomes.get(approved.id)).toBe('applied');
    // An approval from someone without the permission does not count.
    const fake = d.op(
      'discount.apply',
      open.orderId,
      {
        discountId: freshId(),
        itemId: null,
        kind: 'percent',
        value: 5000,
        reasonCode: 'staff',
        reasonText: null,
      },
      { approval: { approverUserId: USER.waiter2, permissions: [] } },
    );
    expect(foldOperations([...base, fake], CONTEXT).outcomes.get(fake.id)).toBe('conflict');
  });
});

describe('payments are never lost (RNF-04, RN-14)', () => {
  it('a payment on a closed order is kept and flagged as overpayment', () => {
    const k1 = new Device(TERMINAL.K1, USER.cashier);
    const h1 = new Device(TERMINAL.H1, USER.waiter);
    const open = k1.open();
    const item = line();
    const base = [open, k1.add(open.orderId, item), k1.serve(open.orderId, item.itemId)];
    h1.sees(...base);
    // Both terminals charge the same table while offline.
    const first = k1.pay(open.orderId, 2450);
    const second = h1.pay(open.orderId, 2450);
    const state = foldOperations([...base, first, second], CONTEXT);
    expect(state.payments.size).toBe(2);
    const later = first.hlc < second.hlc ? second : first;
    expect(
      state.conflicts
        .filter((c) => c.opId === later.id)
        .map((c) => c.code)
        .sort(),
    ).toEqual(['overpayment', 'payment_on_closed_order']);
    expect(state.orders.get(open.orderId)).toMatchObject({ paidRappen: 4900, status: 'closed' });
  });

  it('a payment for an order not yet known is kept until the order arrives', () => {
    const k1 = new Device(TERMINAL.K1, USER.cashier);
    const orderId = freshId();
    const pay = k1.pay(orderId, 1000);
    const state = foldOperations([pay], CONTEXT);
    expect(state.payments.has(pay.payload.paymentId)).toBe(true);
    expect(state.outcomes.get(pay.id)).toBe('conflict');
  });

  it('a refund is linked to its payment; over-refunding is flagged (RF-D07)', () => {
    const d = new Device(TERMINAL.K1, USER.manager);
    const open = d.open();
    const item = line();
    const pay = d.pay(open.orderId, 2450);
    const refund = (amountRappen: number) =>
      d.op('refund.record', open.orderId, {
        refundId: freshId(),
        paymentId: pay.payload.paymentId,
        method: 'card',
        adapter: 'external-terminal',
        amountRappen,
        tipRappen: 0,
        reason: 'Gericht kalt',
        externalReference: null,
      });
    const base = [open, d.add(open.orderId, item), d.serve(open.orderId, item.itemId), pay];
    const full = refund(2450);
    let state = foldOperations([...base, full], CONTEXT);
    expect(state.orders.get(open.orderId)).toMatchObject({
      paymentStatus: 'refunded',
      paidRappen: 0,
    });
    expect(state.outcomes.get(full.id)).toBe('applied');
    const extra = refund(100);
    state = foldOperations([...base, full, extra], CONTEXT);
    expect(state.conflicts).toContainEqual({
      opId: extra.id,
      code: 'refund_exceeds_payment',
      entityId: pay.payload.paymentId,
    });
  });

  it('a reprint is a copy linked to the original receipt (RF-D24)', () => {
    const d = new Device(TERMINAL.K1, USER.cashier);
    const open = d.open();
    const pay = d.pay(open.orderId, 1000);
    const copyId = freshId();
    const state = foldOperations(
      [
        open,
        d.add(open.orderId, line()),
        pay,
        d.op('receipt.reprint', open.orderId, {
          receiptId: pay.payload.receipt.receiptId,
          copyId,
          hubPrint: false,
        }),
      ],
      CONTEXT,
    );
    expect(state.receipts.get(copyId)).toMatchObject({
      copyOfReceiptId: pay.payload.receipt.receiptId,
      receiptNumber: pay.payload.receipt.receiptNumber,
    });
    expect(state.audits.map((a) => a.action)).toContain('receipt.reprinted');
  });
});

describe('transfer, merge and split (RF-C12, RF-C13, DEC-025)', () => {
  it('transfers items with their discount to another order', () => {
    const d = new Device(TERMINAL.H1, USER.manager);
    const a = d.open(freshId(), { tableId: TABLE.t1 });
    const b = d.open(freshId(), { tableId: TABLE.t2 }, 2);
    const item = line();
    const discountId = freshId();
    const state = foldOperations(
      [
        a,
        b,
        d.add(a.orderId, item, beer()),
        d.op('discount.apply', a.orderId, {
          discountId,
          itemId: item.itemId,
          kind: 'percent',
          value: 1000,
          reasonCode: 'promotion',
          reasonText: null,
        }),
        d.op('items.transfer', a.orderId, { itemIds: [item.itemId], toOrderId: b.orderId }),
      ],
      CONTEXT,
    );
    expect(state.items.get(item.itemId)).toMatchObject({
      orderId: b.orderId,
      transferredFromOrderId: a.orderId,
    });
    expect(state.discounts.get(discountId)!.orderId).toBe(b.orderId);
    expect(state.orders.get(b.orderId)!.totalRappen).toBe(2205);
    expect(state.orders.get(a.orderId)!.totalRappen).toBe(650);
  });

  it('never moves items away from an order that has payments', () => {
    const d = new Device(TERMINAL.H1, USER.manager);
    const a = d.open();
    const b = d.open(freshId(), { tableId: TABLE.t2 }, 2);
    const item = line();
    const add = d.add(a.orderId, item, beer());
    const pay = d.pay(a.orderId, 500);
    const transfer = d.op('items.transfer', a.orderId, {
      itemIds: [item.itemId],
      toOrderId: b.orderId,
    });
    const state = foldOperations([a, b, add, pay, transfer], CONTEXT);
    expect(state.items.get(item.itemId)!.orderId).toBe(a.orderId);
    expect(state.conflicts).toContainEqual({
      opId: transfer.id,
      code: 'source_has_payments',
      entityId: a.orderId,
    });
  });

  it('merges an order into another; later items follow the merge', () => {
    const d = new Device(TERMINAL.H1, USER.manager);
    const a = d.open();
    const b = d.open(freshId(), { tableId: TABLE.t2 }, 2);
    const late = line({ name: 'Dessert', unitPriceRappen: 900 });
    const state = foldOperations(
      [
        a,
        b,
        d.add(a.orderId, line()),
        d.add(b.orderId, beer()),
        d.op('order.merge', a.orderId, { intoOrderId: b.orderId }),
        d.add(a.orderId, late),
      ],
      CONTEXT,
    );
    expect(state.orders.get(a.orderId)).toMatchObject({
      status: 'voided',
      voidReason: 'merged',
      mergedIntoOrderId: b.orderId,
    });
    expect(state.items.get(late.itemId)!.orderId).toBe(b.orderId);
    expect(state.orders.get(b.orderId)!.totalRappen).toBe(2450 + 650 + 900);
  });

  it('splits by items into a child order that is paid on its own', () => {
    const d = new Device(TERMINAL.K1, USER.cashier);
    const open = d.open();
    const mine = line({ seat: 1 });
    const yours = beer({ seat: 2 });
    const childId = freshId();
    const add = d.add(open.orderId, mine, yours);
    const split = d.op('order.split', open.orderId, {
      newOrderId: childId,
      itemIds: [yours.itemId],
      number: { businessDate: '2026-10-06', number: 7, prefix: '', display: '0007' },
    });
    const state = foldOperations(
      [open, add, split, d.serve(open.orderId, mine.itemId, yours.itemId), d.pay(childId, 650)],
      CONTEXT,
    );
    expect(state.orders.get(childId)).toMatchObject({
      splitFromOrderId: open.orderId,
      tableId: TABLE.t1,
      displayNumber: '0007',
      status: 'closed',
    });
    expect(state.orders.get(open.orderId)).toMatchObject({ totalRappen: 2450, status: 'open' });
  });
});

describe('reopen and late arrivals (RF-C14, docs/SYNC.md §5)', () => {
  it('a manager reopens a closed order; it closes again when settled', () => {
    const d = new Device(TERMINAL.K1, USER.manager);
    const open = d.open();
    const item = line();
    const add = d.add(open.orderId, item);
    const serve = d.serve(open.orderId, item.itemId);
    const pay = d.pay(open.orderId, 2450);
    const reopen = d.op('order.reopen', open.orderId, { reason: 'Falsch abgerechnet' });
    const base = [open, add, serve, pay, reopen];
    let state = foldOperations(base, CONTEXT);
    expect(state.orders.get(open.orderId)).toMatchObject({
      status: 'open',
      reopenedAt: reopen.deviceAt,
    });
    expect(state.audits.find((a) => a.opId === reopen.id)!.reason).toBe('Falsch abgerechnet');
    const extra = line({ unitPriceRappen: 500 });
    state = foldOperations(
      [
        ...base,
        d.add(open.orderId, extra),
        d.serve(open.orderId, extra.itemId),
        d.pay(open.orderId, 500),
      ],
      CONTEXT,
    );
    expect(state.orders.get(open.orderId)).toMatchObject({ status: 'closed', totalRappen: 2950 });
  });

  it('items ordered on another device after closing reopen the order and are flagged', () => {
    const k1 = new Device(TERMINAL.K1, USER.cashier);
    const h1 = new Device(TERMINAL.H1, USER.waiter);
    const open = k1.open();
    const item = line();
    const base = [
      open,
      k1.add(open.orderId, item),
      k1.serve(open.orderId, item.itemId),
      k1.pay(open.orderId, 2450),
    ];
    h1.sees(...base).wait(60_000);
    const late = h1.add(open.orderId, beer());
    const state = foldOperations([...base, late], CONTEXT);
    expect(state.orders.get(open.orderId)).toMatchObject({ status: 'open', balanceRappen: 650 });
    expect(state.conflicts).toContainEqual({
      opId: late.id,
      code: 'implicit_reopen',
      entityId: open.orderId,
    });
  });

  it('changes the channel before payment and audits it (RN-05); not after', () => {
    const d = new Device(TERMINAL.K1, USER.cashier);
    const open = d.open();
    const food = line();
    const drink = beer();
    const add = d.add(open.orderId, food, drink);
    const change = d.op('order.change_channel', open.orderId, {
      channel: 'takeaway',
      consumptionType: 'takeaway',
      rates: [
        { taxCategoryKey: 'food', taxRateCode: 'reduced', taxRateBp: 260 },
        { taxCategoryKey: 'alcoholic_beverage', taxRateCode: 'normal', taxRateBp: 810 },
      ],
    });
    const base = [open, add];
    let state = foldOperations([...base, change], CONTEXT);
    expect(state.items.get(food.itemId)).toMatchObject({ taxRateCode: 'reduced', taxRateBp: 260 });
    expect(state.items.get(drink.itemId)).toMatchObject({ taxRateCode: 'normal', taxRateBp: 810 });
    expect(state.orders.get(open.orderId)!.channel).toBe('takeaway');
    expect(state.audits.find((a) => a.opId === change.id)!.action).toBe('order.channel_changed');

    const paid = [...base, d.pay(open.orderId, 1000)];
    const late = d.op('order.change_channel', open.orderId, change.payload);
    state = foldOperations([...paid, late], CONTEXT);
    expect(state.items.get(food.itemId)!.taxRateBp).toBe(810);
    expect(state.outcomes.get(late.id)).toBe('conflict');
  });

  it('the last change per field wins, whatever the arrival order (RNF-04)', () => {
    const h1 = new Device(TERMINAL.H1, USER.waiter);
    const h2 = new Device(TERMINAL.H2, USER.waiter2);
    const open = h1.open();
    h2.sees(open);
    const early = h1.op('order.update', open.orderId, { guestCount: 4, note: 'Geburtstag' });
    const late = h2.wait(5_000).op('order.update', open.orderId, { guestCount: 6 });
    for (const ops of [
      [open, early, late],
      [late, early, open],
    ]) {
      const order = foldOperations(ops, CONTEXT).orders.get(open.orderId)!;
      expect(order.guestCount).toBe(6);
      expect(order.note).toBe('Geburtstag');
    }
  });

  it('applying the same operation twice has the effect of once (idempotency)', () => {
    const d = new Device(TERMINAL.K1, USER.cashier);
    const open = d.open();
    const add = d.add(open.orderId, line());
    const pay = d.pay(open.orderId, 1000);
    const once = foldOperations([open, add, pay], CONTEXT);
    const twice = foldOperations([open, add, pay, pay, add, open], CONTEXT);
    expect(twice.orders.get(open.orderId)).toEqual(once.orders.get(open.orderId));
    expect(twice.payments.size).toBe(1);
  });

  it('records PIN unlocks and failures as audit entries', () => {
    const d = new Device(TERMINAL.H1, USER.waiter);
    const state = foldOperations(
      [
        d.op('terminal.pin_failed', null, { attempt: 1 }, { userId: null }),
        d.op('terminal.unlocked', null, {}),
      ],
      CONTEXT,
    );
    expect(state.audits.map((a) => a.action)).toEqual(['terminal.pin_failed', 'terminal.unlocked']);
  });
});
