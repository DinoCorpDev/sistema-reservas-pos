import { describe, expect, it } from 'vitest';
import { closingTotals, type ClosingInput } from '../cash/closing';
import type { PaymentMethod } from '../payments/constants';
import type { Channel } from '../shared/channels';
import { rappen } from '../shared/money';
import { extractTax, type TaxSummaryLine } from '../tax/calculation';
import {
  accountingRows,
  changePerMille,
  type MoneyInput,
  type ReportPayment,
  type ReportRefund,
  salesReport,
  tipsReport,
  vatReport,
} from './money';

/**
 * Every money report adds up to the Zs of its days to the rappen (RF-F01…RF-F04, RF-F07,
 * DEC-038): the same payments and refunds give the Z and the report.
 */

const NORMAL = 810;
const REDUCED = 260;

/** MWST of a receipt with `gross` at each rate. */
function taxes(...parts: [rateBp: number, gross: number][]): TaxSummaryLine[] {
  return parts.map(([rateBp, gross]) => {
    const tax = extractTax(rappen(gross), rateBp);
    return {
      rateCode: rateBp === NORMAL ? 'normal' : 'reduced',
      rateBp,
      grossRappen: rappen(gross),
      taxRappen: tax,
      netRappen: rappen(gross - tax),
    };
  });
}

function payment(
  businessDate: string,
  method: PaymentMethod,
  parts: [number, number][],
  extra: Partial<ReportPayment> = {},
): ReportPayment {
  return {
    businessDate,
    method,
    amountRappen: parts.reduce((total, [, gross]) => total + gross, 0),
    tipRappen: 0,
    roundingRappen: 0,
    hour: 12,
    waiterUserId: 'anna',
    channel: 'table',
    tipUserId: 'anna',
    taxes: taxes(...parts),
    ...extra,
  };
}

function refund(
  of: ReportPayment,
  amountRappen: number,
  extra: Partial<ReportRefund> = {},
): ReportRefund {
  return {
    businessDate: of.businessDate,
    method: of.method,
    amountRappen,
    tipRappen: 0,
    roundingRappen: 0,
    hour: of.hour,
    waiterUserId: of.waiterUserId,
    channel: of.channel,
    tipUserId: of.tipUserId,
    paymentAmountRappen: of.amountRappen,
    paymentTaxes: of.taxes,
    ...extra,
  };
}

/** The Z of one day computed from the same money. */
function zOf(input: MoneyInput, day: string) {
  const closing: ClosingInput = {
    payments: input.payments
      .filter((p) => p.businessDate === day)
      .map((p) => ({ ...p, shiftId: null })),
    refunds: input.refunds
      .filter((r) => r.businessDate === day)
      .map((r) => ({ ...r, shiftId: null })),
    movements: [],
    shifts: [],
    orders: [],
    voids: [],
    reconciliations: [],
  };
  return closingTotals(closing);
}

const dinner = payment(
  '2026-10-09',
  'card',
  [
    [NORMAL, 8_650],
    [REDUCED, 1_230],
  ],
  {
    tipRappen: 300,
    hour: 20,
  },
);
const bar = payment('2026-10-09', 'cash', [[NORMAL, 1_195]], {
  roundingRappen: 5,
  hour: 23,
  waiterUserId: 'luca',
  tipUserId: 'luca',
  channel: 'bar',
});
const takeaway = payment('2026-10-09', 'twint', [[REDUCED, 2_380]], {
  hour: 12,
  channel: 'takeaway',
  waiterUserId: null,
  tipUserId: null,
});
const nextDay = payment(
  '2026-10-10',
  'card',
  [
    [NORMAL, 4_900],
    [REDUCED, 600],
  ],
  {
    tipRappen: 450,
    hour: 19,
    waiterUserId: 'luca',
    tipUserId: 'luca',
  },
);
const otherMonth = payment('2026-11-02', 'cash', [[NORMAL, 3_330]], { roundingRappen: -3 });

const input: MoneyInput = {
  payments: [dinner, bar, takeaway, nextDay, otherMonth],
  refunds: [
    // Part of the dinner back on the same day, with part of the tip.
    refund(dinner, 2_000, { tipRappen: 100 }),
    // The whole takeaway back on the next business day.
    refund(takeaway, 2_380, { businessDate: '2026-10-10', hour: 11 }),
  ],
};
const DAYS = ['2026-10-09', '2026-10-10', '2026-11-02'];
const zs = DAYS.map((day) => zOf(input, day));
const total = <T>(list: readonly T[], value: (item: T) => number) =>
  list.reduce((sum, item) => sum + value(item), 0);

describe('sales (RF-F01)', () => {
  const report = salesReport(input);

  it('the total, the tips and the rounding are those of the Zs', () => {
    expect(report.salesRappen).toBe(total(zs, (z) => z.grossSalesRappen));
    expect(report.tipsRappen).toBe(total(zs, (z) => z.tipsRappen));
    expect(report.roundingRappen).toBe(total(zs, (z) => z.roundingRappen));
    expect(report.refundsRappen).toBe(total(zs, (z) => z.refundsRappen));
  });

  it('every breakdown adds up to the total', () => {
    const breakdowns: readonly (readonly { salesRappen: number }[])[] = [
      report.byDay,
      report.byHour,
      report.byWaiter,
      report.byChannel,
      report.byMethod,
    ];
    for (const lines of breakdowns) {
      expect(total(lines, (line) => line.salesRappen)).toBe(report.salesRappen);
    }
  });

  it('each day is its Z; refunds count on the day they are made', () => {
    expect(report.byDay.map((line) => [line.key, line.salesRappen])).toEqual(
      DAYS.map((day, index) => [day, zs[index]!.grossSalesRappen]),
    );
    expect(report.byDay.find((line) => line.key === '2026-10-10')).toMatchObject({
      paymentCount: 1,
      refundCount: 1,
      salesRappen: 4_900 + 600 - 2_380,
    });
  });

  it('by hour has the 24 hours; by method follows the Z per method', () => {
    expect(report.byHour.map((line) => line.key)).toEqual([...Array(24).keys()]);
    expect(report.byHour[20]!.salesRappen).toBe(8_650 + 1_230 - 2_000);
    const methods = new Map(report.byMethod.map((line) => [line.key, line.salesRappen]));
    for (const method of ['card', 'cash', 'twint'] as const) {
      expect(methods.get(method)).toBe(
        total(zs, (z) => z.byPaymentMethod.find((m) => m.method === method)?.salesRappen ?? 0),
      );
    }
  });

  it('by waiter and channel: an order without waiter keeps its own line', () => {
    const waiters = new Map(report.byWaiter.map((line) => [line.key, line.salesRappen]));
    expect(waiters.get(null)).toBe(0);
    expect(waiters.get('anna')).toBe(8_650 + 1_230 - 2_000 + 3_330);
    const channels = new Map<Channel, number>(
      report.byChannel.map((line) => [line.key, line.salesRappen]),
    );
    expect(channels.get('bar')).toBe(1_195);
  });

  it('the change against the previous period, in per mille', () => {
    expect(changePerMille(11_000, 10_000)).toBe(100);
    expect(changePerMille(9_000, 10_000)).toBe(-100);
    expect(changePerMille(5_000, 0)).toBeNull();
  });
});

describe('MWST by rate and period (RF-F02)', () => {
  it('one day is its Z by rate', () => {
    const day = vatReport(
      {
        payments: input.payments.filter((p) => p.businessDate === '2026-10-09'),
        refunds: input.refunds.filter((r) => r.businessDate === '2026-10-09'),
      },
      'day',
    );
    expect(day.byTaxRate).toEqual(zs[0]!.byTaxRate);
  });

  it('a month is the sum of its Zs rate by rate; gross = sales', () => {
    const report = vatReport(input, 'month');
    expect(report.periods.map((period) => period.key)).toEqual(['2026-10', '2026-11']);
    const october = report.periods[0]!;
    for (const rate of october.byTaxRate) {
      const fromZs = (field: 'grossRappen' | 'taxRappen' | 'netRappen') =>
        total(
          zs.slice(0, 2),
          (z) => z.byTaxRate.find((r) => r.rateBp === rate.rateBp)?.[field] ?? 0,
        );
      expect([rate.grossRappen, rate.taxRappen, rate.netRappen]).toEqual([
        fromZs('grossRappen'),
        fromZs('taxRappen'),
        fromZs('netRappen'),
      ]);
    }
    expect(report.grossRappen).toBe(total(zs, (z) => z.grossSalesRappen));
    expect(report.taxRappen).toBe(total(report.periods, (period) => period.taxRappen));
    expect(report.grossRappen - report.taxRappen).toBe(report.netRappen);
  });

  it('quarters and halves follow the MWST settlement periods', () => {
    expect(vatReport(input, 'quarter').periods.map((p) => p.key)).toEqual(['2026-Q4']);
    expect(vatReport(input, 'half').periods.map((p) => p.key)).toEqual(['2026-H2']);
  });

  it('a full refund cancels the sale and its MWST to the rappen', () => {
    const report = vatReport(
      { payments: [takeaway], refunds: [refund(takeaway, takeaway.amountRappen)] },
      'day',
    );
    expect(report.byTaxRate).toEqual([]);
    expect([report.grossRappen, report.taxRappen]).toEqual([0, 0]);
  });
});

describe('accounting export (RF-F04)', () => {
  const rows = accountingRows(input);
  const sales = rows.filter((row) => row.kind === 'sale');

  it('the sale rows are the turnover and MWST of the Zs', () => {
    expect(total(sales, (row) => row.grossRappen)).toBe(total(zs, (z) => z.grossSalesRappen));
    expect(total(sales, (row) => row.taxRappen)).toBe(
      total(zs, (z) => total(z.byTaxRate, (rate) => rate.taxRappen)),
    );
  });

  it('per day and method, all rows are what the drawer or the terminal took', () => {
    for (const [index, day] of DAYS.entries()) {
      for (const line of zs[index]!.byPaymentMethod) {
        const own = rows.filter((row) => row.businessDate === day && row.method === line.method);
        expect(total(own, (row) => row.grossRappen)).toBe(line.totalRappen);
      }
    }
  });

  it('tips and rounding carry no MWST', () => {
    const extras = rows.filter((row) => row.kind !== 'sale');
    expect(extras.length).toBeGreaterThan(0);
    for (const row of extras) {
      expect(row).toMatchObject({ rateCode: null, rateBp: null, taxRappen: 0 });
      expect(row.netRappen).toBe(row.grossRappen);
    }
  });

  it('sorted by day, then method, sales before tips and rounding', () => {
    expect(rows[0]).toMatchObject({ businessDate: '2026-10-09', method: 'cash', kind: 'sale' });
    expect(rows.at(-1)).toMatchObject({ businessDate: '2026-11-02', kind: 'rounding' });
  });
});

describe('tips by person (RF-F07, RN-07)', () => {
  it('add up to the tips of the Zs, refunded tips taken off', () => {
    const report = tipsReport(input);
    expect(report.tipsRappen).toBe(total(zs, (z) => z.tipsRappen));
    expect(report.byPerson).toEqual([
      { userId: 'luca', tipsRappen: 450, count: 1 },
      { userId: 'anna', tipsRappen: 200, count: 1 },
    ]);
  });
});
