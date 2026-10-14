import { describe, expect, it } from 'vitest';
import { receiptTaxes } from '../receipts/build';
import { rappen } from '../shared/money';
import { extractTax } from '../tax/calculation';
import { cashBook } from './book';
import { type ClosingInput, type ClosingShift, closingTotals, posTotalsByMethod } from './closing';

/** A receipt's MWST: Rösti 24.50 at 8.1 % and a beer 6.50 at 8.1 %, and a takeaway at 2.6 %. */
const lineOf = (total: number, rateBp: number, rateCode: 'normal' | 'reduced') => ({
  lineTotalRappen: rappen(total),
  taxRappen: extractTax(rappen(total), rateBp),
  taxRateCode: rateCode,
  taxRateBp: rateBp,
});
const DINNER = [lineOf(2450, 810, 'normal'), lineOf(650, 810, 'normal')];
const TAKEAWAY = [lineOf(1800, 260, 'reduced')];
const taxesOf = (lines: typeof DINNER, total: number, amount = total) =>
  receiptTaxes(lines, rappen(total), rappen(amount));

const SHIFT: ClosingShift = {
  id: 'shift-1',
  scope: 'terminal',
  ownerName: 'Kasse 1',
  status: 'closed',
  openingFloatRappen: 20000,
  expectedCashRappen: 20000 + 3115 - 1005 - 1250,
  countedCashRappen: 20000 + 3115 - 1005 - 1250 - 50,
  differenceRappen: -50,
  differenceComment: 'Münze',
};

/** A day: cash dinner with tip, card takeaway split in two, a partial cash refund, movements. */
function day(): ClosingInput {
  return {
    payments: [
      // 31.00 + tip 0.13 → 31.15 collected (rounding +2).
      {
        method: 'cash',
        amountRappen: 3100,
        tipRappen: 13,
        roundingRappen: 2,
        shiftId: 'shift-1',
        taxes: taxesOf(DINNER, 3100),
      },
      {
        method: 'card',
        amountRappen: 1000,
        tipRappen: 200,
        roundingRappen: 0,
        shiftId: 'shift-1',
        taxes: taxesOf(TAKEAWAY, 1800, 1000),
      },
      {
        method: 'twint',
        amountRappen: 800,
        tipRappen: 0,
        roundingRappen: 0,
        shiftId: null,
        taxes: taxesOf(TAKEAWAY, 1800, 800),
      },
    ],
    refunds: [
      // 10.03 of the dinner back in cash, paid out 10.05.
      {
        method: 'cash',
        amountRappen: 1003,
        tipRappen: 0,
        roundingRappen: 2,
        shiftId: 'shift-1',
        paymentAmountRappen: 3100,
        paymentTaxes: taxesOf(DINNER, 3100),
      },
    ],
    movements: [
      { kind: 'cash_in', amountRappen: 5000, shiftId: 'shift-1' },
      { kind: 'cash_out', amountRappen: -5000, shiftId: 'shift-1' },
      { kind: 'expense', amountRappen: -1250, shiftId: 'shift-1' },
    ],
    shifts: [SHIFT],
    orders: [
      { discountRappen: 0, discountCount: 0 },
      { discountRappen: 200, discountCount: 1 },
    ],
    voids: [{ grossRappen: 650 }],
    reconciliations: [
      {
        method: 'card',
        posTotalRappen: 1200,
        terminalTotalRappen: 1200,
        differenceRappen: 0,
        reason: null,
      },
    ],
  };
}

describe('closingTotals (RF-D15, DEC-038)', () => {
  const totals = closingTotals(day());

  it('turnover is the sales net of refunds; tips and rounding stay outside it', () => {
    expect(totals.grossSalesRappen).toBe(3100 + 1000 + 800 - 1003);
    expect(totals.tipsRappen).toBe(213);
    expect(totals.roundingRappen).toBe(0); // +2 collected, +2 paid back
    expect(totals.refundsRappen).toBe(1003);
    expect(totals).toMatchObject({ paymentCount: 3, refundCount: 1, orderCount: 2 });
  });

  it('per method: what was collected minus what was paid back, in a fixed order', () => {
    expect(totals.byPaymentMethod).toEqual([
      {
        method: 'cash',
        paymentCount: 1,
        refundCount: 1,
        salesRappen: 2097,
        tipsRappen: 13,
        roundingRappen: 0,
        totalRappen: 3115 - 1005,
      },
      {
        method: 'card',
        paymentCount: 1,
        refundCount: 0,
        salesRappen: 1000,
        tipsRappen: 200,
        roundingRappen: 0,
        totalRappen: 1200,
      },
      {
        method: 'twint',
        paymentCount: 1,
        refundCount: 0,
        salesRappen: 800,
        tipsRappen: 0,
        roundingRappen: 0,
        totalRappen: 800,
      },
    ]);
    expect(posTotalsByMethod(totals).get('card')).toBe(1200);
  });

  it('squares to the rappen: Σ methods = sales + tips + rounding', () => {
    const collected = totals.byPaymentMethod.reduce((sum, m) => sum + m.totalRappen, 0);
    expect(collected).toBe(totals.grossSalesRappen + totals.tipsRappen + totals.roundingRappen);
  });

  it('MWST per rate comes from the receipts net of refunds, and adds up to the sales', () => {
    const gross = totals.byTaxRate.reduce((sum, t) => sum + t.grossRappen, 0);
    expect(gross).toBe(totals.grossSalesRappen);
    expect(totals.byTaxRate.map((t) => t.rateCode)).toEqual(['normal', 'reduced']);
    for (const rate of totals.byTaxRate)
      expect(rate.netRappen + rate.taxRappen).toBe(rate.grossRappen);
    // A full refund cancels its receipt exactly.
    const full = closingTotals({
      ...day(),
      payments: [day().payments[0]!],
      refunds: [{ ...day().refunds[0]!, amountRappen: 3100, roundingRappen: 0 }],
    });
    expect(full.byTaxRate).toEqual([]);
    expect(full.grossSalesRappen).toBe(0);
  });

  it('cash: floats, collected, paid out, movements by kind and the counts of the shifts', () => {
    expect(totals.cash).toEqual({
      openingFloatRappen: 20000,
      collectedRappen: 3115,
      paidOutRappen: 1005,
      movementsRappen: -1250,
      movementsByKind: { cash_in: 5000, cash_out: -5000, expense: -1250, correction: 0 },
      expectedRappen: SHIFT.expectedCashRappen,
      countedRappen: SHIFT.countedCashRappen,
      differenceRappen: -50,
      unassignedRappen: 0,
    });
    // The drawer: float + collected − paid out + movements = expected.
    expect(20000 + 3115 - 1005 - 1250).toBe(SHIFT.expectedCashRappen);
  });

  it('cash without a shift is reported apart, never hidden', () => {
    const input = day();
    const old = closingTotals({ ...input, payments: [{ ...input.payments[0]!, shiftId: null }] });
    expect(old.cash.unassignedRappen).toBe(3115 - 0);
  });

  it('discounts, voids and reconciliations as recorded', () => {
    expect(totals).toMatchObject({
      discountsRappen: 200,
      discountCount: 1,
      voidsRappen: 650,
      voidCount: 1,
    });
    expect(totals.reconciliations).toHaveLength(1);
    expect(totals.shifts).toEqual([SHIFT]);
  });

  it('an empty day closes at zero', () => {
    const empty = closingTotals({
      payments: [],
      refunds: [],
      movements: [],
      shifts: [],
      orders: [],
      voids: [],
      reconciliations: [],
    });
    expect(empty).toMatchObject({
      grossSalesRappen: 0,
      byPaymentMethod: [],
      byTaxRate: [],
      orderCount: 0,
    });
  });
});

describe('cashBook (RF-D16)', () => {
  it('lists the cash of the day in time order with the running balance', () => {
    const book = cashBook([
      {
        at: '2026-10-06T18:30:00Z',
        kind: 'sale',
        shiftId: 's',
        reference: 'K1-261006-0001',
        amountRappen: 3115,
      },
      {
        at: '2026-10-06T16:00:00Z',
        kind: 'opening',
        shiftId: 's',
        reference: null,
        amountRappen: 20000,
      },
      {
        at: '2026-10-06T19:00:00Z',
        kind: 'refund',
        shiftId: 's',
        reference: 'K1-261006-0001',
        amountRappen: -1005,
      },
      {
        at: '2026-10-06T20:00:00Z',
        kind: 'difference',
        shiftId: 's',
        reference: 'Münze',
        amountRappen: -50,
      },
      {
        at: '2026-10-06T20:00:00Z',
        kind: 'expense',
        shiftId: 's',
        reference: 'Blumen',
        amountRappen: -1250,
      },
    ]);
    expect(book.lines.map((l) => [l.kind, l.balanceRappen])).toEqual([
      ['opening', 20000],
      ['sale', 23115],
      ['refund', 22110],
      ['expense', 20860],
      ['difference', 20810],
    ]);
    expect(book).toMatchObject({ inRappen: 23115, outRappen: 2305, endBalanceRappen: 20810 });
  });

  it('is empty on a day without cash', () => {
    expect(cashBook([])).toEqual({ lines: [], inRappen: 0, outRappen: 0, endBalanceRappen: 0 });
  });
});
