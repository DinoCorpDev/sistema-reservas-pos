import { describe, expect, it } from 'vitest';
import type { Operation } from '../orders/operations';
import { foldOperations } from '../orders/reducer';
import { movementsOfShift, paymentsOfShift, refundsOfShift } from '../orders/state';
import {
  beer,
  CONTEXT,
  Device,
  freshId,
  line,
  projection,
  random,
  shuffle,
  TERMINAL,
  USER,
} from '../orders/test-kit';
import { rappen } from '../shared/money';
import { expectedCash, openShiftOf } from './shifts';

const fold = (...ops: Operation[]) => foldOperations(ops, CONTEXT);
const codes = (ops: Operation[]) =>
  fold(...ops).conflicts.map((c) => `${c.code}:${c.entityId === null ? '-' : 'x'}`);
const conflictsOf = (state: ReturnType<typeof fold>, opId: string) =>
  state.conflicts.filter((c) => c.opId === opId).map((c) => c.code);

/** A cash payment of `amount` into `shiftId`, with change for a 100 note. */
function cash(d: Device, orderId: string, amount: number, shiftId: string | null, tip = 0) {
  const total = amount + tip;
  const rounded = Math.round(total / 5) * 5;
  return d.pay(orderId, amount, {
    method: 'cash',
    adapter: 'cash',
    tipRappen: tip,
    roundingRappen: rounded - total,
    tenderedRappen: 10000,
    changeRappen: 10000 - rounded,
    shiftId,
  });
}

describe('expectedCash (RF-D14)', () => {
  it('is the float plus cash collected, minus cash paid back, plus movements', () => {
    const expected = expectedCash({
      openingFloatRappen: rappen(20000),
      payments: [
        // 47.23 + tip 2.00, rounded to 49.25: the drawer keeps 49.25 (the change went back).
        {
          method: 'cash',
          amountRappen: rappen(4723),
          tipRappen: rappen(200),
          roundingRappen: rappen(2),
        },
        // Card money never reaches the drawer.
        {
          method: 'card',
          amountRappen: rappen(9999),
          tipRappen: rappen(500),
          roundingRappen: rappen(0),
        },
      ],
      refunds: [
        {
          method: 'cash',
          amountRappen: rappen(1003),
          tipRappen: rappen(0),
          roundingRappen: rappen(2),
        },
        {
          method: 'twint',
          amountRappen: rappen(700),
          tipRappen: rappen(0),
          roundingRappen: rappen(0),
        },
      ],
      movements: [{ amountRappen: rappen(5000) }, { amountRappen: rappen(-1250) }],
    });
    expect(expected).toBe(20000 + 4925 - 1005 + 5000 - 1250);
  });

  it('is the float alone for an empty shift', () => {
    expect(
      expectedCash({ openingFloatRappen: rappen(0), payments: [], refunds: [], movements: [] }),
    ).toBe(0);
  });
});

describe('shifts in the fold (RF-D12…RF-D15, RN-19, DEC-038)', () => {
  it('opens, takes cash, moves cash and closes with the count', () => {
    const k1 = new Device(TERMINAL.K1, USER.cashier);
    const shiftId = freshId();
    const open = k1.open();
    const item = line();
    const ops = [
      k1.openShift(shiftId, 20000),
      open,
      k1.add(open.orderId, item),
      cash(k1, open.orderId, 2450, shiftId),
      k1.movement(shiftId, 'expense', -1250, 'Blumen'),
      k1.movement(shiftId, 'cash_in', 5000, 'Wechselgeld'),
    ];
    const before = fold(...ops);
    const shift = before.shifts.get(shiftId)!;
    expect(shift).toMatchObject({ status: 'open', scope: 'terminal', terminalId: TERMINAL.K1 });
    expect(paymentsOfShift(before, shiftId)).toHaveLength(1);
    expect(movementsOfShift(before, shiftId)).toHaveLength(2);
    expect(openShiftOf(before, { scope: 'terminal', terminalId: TERMINAL.K1 })?.id).toBe(shiftId);

    const expected = 20000 + 2450 - 1250 + 5000;
    const state = fold(...ops, k1.closeShift(shiftId, expected, expected - 50, 'Münze fehlt'));
    expect(state.conflicts).toEqual([]);
    expect(state.shifts.get(shiftId)).toMatchObject({
      status: 'closed',
      closedByUserId: USER.cashier,
      expectedCashRappen: expected,
      countedCashRappen: expected - 50,
      differenceRappen: -50,
      differenceComment: 'Münze fehlt',
    });
    expect(openShiftOf(state, { scope: 'terminal', terminalId: TERMINAL.K1 })).toBeUndefined();
    expect(state.audits.map((a) => a.action)).toEqual(
      expect.arrayContaining(['shift.opened', 'cash.movement_recorded', 'shift.closed']),
    );
  });

  it('RN-19: a second open shift of the same till is flagged, the first one stays', () => {
    const k1 = new Device(TERMINAL.K1, USER.cashier);
    const first = k1.openShift();
    const second = k1.openShift();
    const state = fold(first, second);
    expect(conflictsOf(state, second.id)).toEqual(['shift_already_open']);
    expect(conflictsOf(state, first.id)).toEqual([]);
    expect(openShiftOf(state, { scope: 'terminal', terminalId: TERMINAL.K1 })?.id).toBe(
      first.payload.shiftId,
    );
    // Once the first is closed, a new one is fine.
    const close = k1.closeShift(first.payload.shiftId, 20000);
    expect(codes([first, close, k1.openShift()])).toEqual([]);
  });

  it('RN-19: one wallet per person, whatever the device; tills and wallets coexist', () => {
    const phone = new Device(TERMINAL.H1, USER.waiter);
    const other = new Device(TERMINAL.H2, USER.waiter);
    const k1 = new Device(TERMINAL.K1, USER.cashier);
    const wallet = (d: Device, userId: string) =>
      d.openShift(freshId(), 0, { scope: 'personal', cashierUserId: userId });
    const mine = wallet(phone, USER.waiter);
    const again = wallet(other, USER.waiter);
    const colleague = wallet(other, USER.waiter2);
    const till = k1.openShift();
    const state = fold(mine, again, colleague, till);
    expect(conflictsOf(state, again.id)).toEqual(['shift_already_open']);
    expect(conflictsOf(state, colleague.id)).toEqual([]);
    expect(conflictsOf(state, till.id)).toEqual([]);
  });

  it('RN-19: cash needs a shift from version 3 on; card and older operations do not', () => {
    const k1 = new Device(TERMINAL.K1, USER.cashier);
    const open = k1.open();
    const add = k1.add(open.orderId, line(), beer());
    const noShift = cash(k1, open.orderId, 1000, null);
    const card = k1.pay(open.orderId, 500);
    const v2 = { ...cash(k1, open.orderId, 1000, null), schemaVersion: 2 } as Operation;
    const state = fold(open, add, noShift, card, v2);
    expect(conflictsOf(state, noShift.id)).toEqual(['cash_without_shift']);
    expect(conflictsOf(state, card.id)).toEqual([]);
    expect(conflictsOf(state, v2.id)).toEqual([]);
    // The money is recorded anyway.
    expect(state.payments.size).toBe(3);
  });

  it('money into a closed, unknown or someone else’s shift is recorded and flagged', () => {
    const k1 = new Device(TERMINAL.K1, USER.cashier);
    const h1 = new Device(TERMINAL.H1, USER.waiter);
    const shiftId = freshId();
    const wallet = freshId();
    const open = k1.open();
    const ops: Operation[] = [
      k1.openShift(shiftId),
      h1.openShift(wallet, 0, { scope: 'personal', cashierUserId: USER.waiter }),
      open,
      k1.add(open.orderId, line(), line(), line()),
    ];
    h1.sees(...ops);
    const otherTerminal = cash(h1, open.orderId, 100, shiftId);
    const otherPerson = cash(k1, open.orderId, 100, wallet);
    const unknown = cash(k1, open.orderId, 100, freshId());
    const close = k1.closeShift(shiftId, 20000);
    const late = cash(k1, open.orderId, 100, shiftId);
    const lateMove = k1.movement(shiftId, 'cash_in', 100);
    const state = fold(...ops, otherTerminal, otherPerson, unknown, close, late, lateMove);
    expect(conflictsOf(state, otherTerminal.id)).toEqual(['shift_mismatch']);
    expect(conflictsOf(state, otherPerson.id)).toEqual(['shift_mismatch']);
    expect(conflictsOf(state, unknown.id)).toEqual(['shift_not_found']);
    expect(conflictsOf(state, late.id)).toEqual(['shift_closed']);
    expect(conflictsOf(state, lateMove.id)).toEqual(['shift_closed']);
    expect(paymentsOfShift(state, shiftId)).toHaveLength(2);
  });

  it('the first close counts; a second one is flagged and changes nothing', () => {
    const k1 = new Device(TERMINAL.K1, USER.cashier);
    const shiftId = freshId();
    const opening = k1.openShift(shiftId);
    const first = k1.closeShift(shiftId, 20000);
    const second = k1.closeShift(shiftId, 20000, 19000, 'anders gezählt');
    const state = fold(opening, first, second);
    expect(conflictsOf(state, second.id)).toEqual(['shift_closed']);
    expect(state.shifts.get(shiftId)?.countedCashRappen).toBe(20000);
  });

  it('a payment the closing device did not know is a count mismatch to explain', () => {
    // A wallet used on two devices: the phone closes it before seeing the POS payment.
    const phone = new Device(TERMINAL.H1, USER.waiter);
    const pos = new Device(TERMINAL.K1, USER.waiter);
    const wallet = freshId();
    const open = pos.open();
    const opening = phone.openShift(wallet, 0, { scope: 'personal', cashierUserId: USER.waiter });
    pos.sees(opening);
    const add = pos.add(open.orderId, line());
    const paid = cash(pos, open.orderId, 2450, wallet);
    phone.wait(10_000);
    const close = phone.closeShift(wallet, 0);
    const state = fold(opening, open, add, paid, close);
    expect(conflictsOf(state, close.id)).toEqual(['shift_count_mismatch']);
    // The frozen expected stays what the waiter saw and signed.
    expect(state.shifts.get(wallet)?.expectedCashRappen).toBe(0);
  });

  it('only who may open or close a shift does it, without approval', () => {
    const cook = new Device(TERMINAL.K1, USER.cook);
    const open = cook.openShift();
    expect(conflictsOf(fold(open), open.id)).toEqual(['approval_invalid']);
    const waiter = new Device(TERMINAL.H1, USER.waiter);
    const wallet = waiter.openShift(freshId(), 0, {
      scope: 'personal',
      cashierUserId: USER.waiter,
    });
    expect(conflictsOf(fold(wallet), wallet.id)).toEqual([]);
    // A waiter has no cash movements of their own by default.
    const move = waiter.movement(wallet.payload.shiftId, 'cash_in', 100);
    expect(conflictsOf(fold(wallet, move), move.id)).toEqual(['approval_invalid']);
  });

  it('a cash refund paid out rounded nets the order rounding (RN-06, DEC-038)', () => {
    const k1 = new Device(TERMINAL.K1, USER.manager);
    const shiftId = freshId();
    const open = k1.open();
    const item = line({ unitPriceRappen: 1003 });
    const pay = cash(k1, open.orderId, 1003, shiftId);
    const refund = k1.op('refund.record', open.orderId, {
      refundId: freshId(),
      paymentId: pay.payload.paymentId,
      method: 'cash',
      adapter: 'cash',
      amountRappen: 1003,
      tipRappen: 0,
      roundingRappen: 2,
      reason: 'kalt',
      externalReference: null,
      shiftId,
    });
    const state = fold(k1.openShift(shiftId, 0), open, k1.add(open.orderId, item), pay, refund);
    expect(state.orders.get(open.orderId)?.roundingTotalRappen).toBe(0);
    expect(refundsOfShift(state, shiftId)).toHaveLength(1);
    const shift = state.shifts.get(shiftId)!;
    expect(
      expectedCash({
        openingFloatRappen: shift.openingFloatRappen,
        payments: paymentsOfShift(state, shiftId),
        refunds: refundsOfShift(state, shiftId),
        movements: movementsOfShift(state, shiftId),
      }),
    ).toBe(0);
  });

  it('converges to the same shifts whatever the arrival order (RNF-04)', () => {
    const k1 = new Device(TERMINAL.K1, USER.cashier);
    const h1 = new Device(TERMINAL.H1, USER.waiter);
    const till = freshId();
    const wallet = freshId();
    const a = k1.open();
    const b = h1.open();
    const ops: Operation[] = [
      k1.openShift(till, 15000),
      h1.openShift(wallet, 0, { scope: 'personal', cashierUserId: USER.waiter }),
      k1.openShift(), // a second till shift: flagged
      a,
      b,
      k1.add(a.orderId, line(), beer()),
      h1.add(b.orderId, line()),
      cash(k1, a.orderId, 2450, till, 30),
      k1.pay(a.orderId, 650, { shiftId: till }),
      cash(h1, b.orderId, 2450, wallet),
      k1.movement(till, 'cash_out', -5000, 'Bank'),
      cash(k1, a.orderId, 100, null),
      k1.closeShift(till, 15000 + 2480 - 5000),
      cash(k1, a.orderId, 100, till),
    ];
    const reference = projection(fold(...ops));
    const next = random(38);
    for (let run = 0; run < 25; run += 1) {
      expect(projection(fold(...shuffle(ops, next)))).toEqual(reference);
    }
  });
});
