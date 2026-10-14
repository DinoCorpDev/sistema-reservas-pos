import { describe, expect, it } from 'vitest';
import type { Operation } from '../orders/operations';
import { foldOperations } from '../orders/reducer';
import { beer, CONTEXT, Device, freshId, line, TERMINAL, USER } from '../orders/test-kit';
import type { ReceiptContent } from '../receipts/content';
import { shiftReportSchema } from './report';
import { shiftReport } from './shift-report';

/** A cash payment whose receipt carries real MWST lines. */
function paid(
  d: Device,
  orderId: string,
  amount: number,
  shiftId: string,
  method: 'cash' | 'card',
  taxes: {
    rateCode: 'normal' | 'reduced';
    rateBp: number;
    grossRappen: number;
    taxRappen: number;
  }[],
  tip = 0,
) {
  const total = amount + tip;
  const rounding = method === 'cash' ? Math.round(total / 5) * 5 - total : 0;
  const op = d.pay(orderId, amount, {
    method,
    adapter: method === 'cash' ? 'cash' : 'external-terminal',
    tipRappen: tip,
    roundingRappen: rounding,
    shiftId,
  });
  const content = {
    taxes: taxes.map((t) => ({ ...t, netRappen: t.grossRappen - t.taxRappen })),
  } as unknown as ReceiptContent;
  return { ...op, payload: { ...op.payload, receipt: { ...op.payload.receipt, content } } };
}

describe('shiftReport (RF-D15)', () => {
  it('sums the shift like the Z: methods, refunds, MWST, discounts, voids, movements, cash', () => {
    const k1 = new Device(TERMINAL.K1, USER.manager);
    const shiftId = freshId();
    const a = k1.open();
    const rosti = line();
    const drink = beer();
    const b = k1.open(freshId(), {}, 2);
    const discountId = freshId();
    const pay1 = paid(
      k1,
      a.orderId,
      3100,
      shiftId,
      'cash',
      [{ rateCode: 'normal', rateBp: 810, grossRappen: 3100, taxRappen: 232 }],
      13,
    );
    const ops: Operation[] = [
      k1.openShift(shiftId, 20000),
      a,
      k1.add(a.orderId, rosti, drink),
      pay1,
      b,
      k1.add(
        b.orderId,
        line({ unitPriceRappen: 2000, taxRateCode: 'reduced', taxRateBp: 260 }),
        beer(),
      ),
      k1.op('discount.apply', b.orderId, {
        discountId,
        itemId: null,
        kind: 'percent',
        value: 1000,
        reasonCode: 'staff',
        reasonText: null,
      }),
      k1.op('item.void', b.orderId, {
        itemId: freshId(),
        quantity: 1,
        voidedItemId: freshId(),
        reason: 'entry_error',
        reasonText: null,
      }),
      k1.op('refund.record', a.orderId, {
        refundId: freshId(),
        paymentId: pay1.payload.paymentId,
        method: 'cash',
        adapter: 'cash',
        amountRappen: 650,
        tipRappen: 0,
        roundingRappen: 0,
        reason: 'Bier warm',
        externalReference: null,
        shiftId,
      }),
      k1.movement(shiftId, 'expense', -1250, 'Blumen'),
      k1.movement(shiftId, 'cash_in', 5000, 'Münz'),
    ];
    const state = foldOperations(ops, CONTEXT);
    // A real void of the beer of order b.
    const beerOfB = [...state.items.values()].find(
      (i) => i.orderId === b.orderId && i.name === 'Bier',
    )!;
    const voidOp = k1.op('item.void', b.orderId, {
      itemId: beerOfB.id,
      quantity: 1,
      voidedItemId: freshId(),
      reason: 'entry_error',
      reasonText: null,
    });
    const withVoid = foldOperations([...ops, voidOp], CONTEXT);
    const until = new Date(Date.parse(voidOp.deviceAt) + 1000).toISOString();
    const report = shiftReport(withVoid, shiftId, {
      until,
      ownerName: 'Kasse 1',
      timeZone: 'Europe/Zurich',
    });

    expect(shiftReportSchema.parse(report)).toEqual(report);
    expect(report.payments).toEqual([
      {
        method: 'cash',
        count: 1,
        amountRappen: 3100,
        tipRappen: 13,
        roundingRappen: 2,
        collectedRappen: 3115,
      },
    ]);
    expect(report.refunds).toEqual([
      {
        method: 'cash',
        count: 1,
        amountRappen: 650,
        tipRappen: 0,
        roundingRappen: 0,
        paidOutRappen: 650,
      },
    ]);
    // MWST of the receipt net of the refund, split over the receipt's rate.
    expect(report.taxes).toEqual([
      { rateCode: 'normal', rateBp: 810, grossRappen: 2450, taxRappen: 183, netRappen: 2267 },
    ]);
    expect(report).toMatchObject({ discountCount: 1, voidCount: 1, voidsRappen: 650 });
    expect(report.discountsRappen).toBeGreaterThan(0);
    expect(report.movements).toEqual([
      { kind: 'cash_in', count: 1, amountRappen: 5000 },
      { kind: 'expense', count: 1, amountRappen: -1250 },
    ]);
    expect(report.cash).toEqual({
      openingFloatRappen: 20000,
      collectedRappen: 3115,
      paidOutRappen: 650,
      movementsRappen: 3750,
      expectedRappen: 20000 + 3115 - 650 + 3750,
    });
    expect(state.shifts.get(shiftId)?.status).toBe('open');
  });

  it('a wallet counts only its person’s discounts and voids', () => {
    const phone = new Device(TERMINAL.H1, USER.waiter);
    const other = new Device(TERMINAL.H1, USER.waiter2);
    const wallet = freshId();
    const a = phone.open();
    const item = line();
    const ops: Operation[] = [
      phone.openShift(wallet, 0, { scope: 'personal', cashierUserId: USER.waiter }),
      a,
      phone.add(a.orderId, item, line()),
    ];
    other.sees(...ops);
    const foreignVoid = other.op('item.void', a.orderId, {
      itemId: item.itemId,
      quantity: 1,
      voidedItemId: freshId(),
      reason: 'entry_error',
      reasonText: null,
    });
    const state = foldOperations([...ops, foreignVoid], CONTEXT);
    const report = shiftReport(state, wallet, {
      until: new Date(Date.parse(foreignVoid.deviceAt) + 1000).toISOString(),
      ownerName: 'Anna',
      timeZone: 'Europe/Zurich',
    });
    expect(report).toMatchObject({
      scope: 'personal',
      voidCount: 0,
      discountCount: 0,
      payments: [],
    });
    expect(report.cash.expectedRappen).toBe(0);
  });
});
