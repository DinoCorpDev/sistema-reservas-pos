import { netTaxes, taxesOfRefund } from '../cash/closing';
import { PAYMENT_METHODS, type PaymentMethod } from '../payments/constants';
import type { Channel } from '../shared/channels';
import type { IsoDate, TaxSummaryLine } from '../tax/calculation';
import type { TaxRateCode } from '../tax/constants';
import { periodKey, type VatGranularity } from './period';

/**
 * Reports on money (RF-F01, RF-F02, RF-F04, RF-F07) with the rule of the Z (DEC-038): what was
 * collected by the payments of the business days, net of the refunds of those days, with the
 * MWST of their receipts. Any period made of whole days adds up to its Zs to the rappen. Pure:
 * the service reads the rows and every report is a fold of the same two lists.
 */

export interface ReportPayment {
  businessDate: IsoDate;
  method: PaymentMethod;
  /** Sale part (MWST included); the tip and the cash rounding are apart. */
  amountRappen: number;
  tipRappen: number;
  roundingRappen: number;
  /** Local hour of the payment (0–23), for the sales by hour. */
  hour: number;
  waiterUserId: string | null;
  channel: Channel;
  /** Who gets the tip. */
  tipUserId: string | null;
  /** MWST of the payment's receipt. */
  taxes: readonly TaxSummaryLine[];
}

export interface ReportRefund {
  businessDate: IsoDate;
  method: PaymentMethod;
  amountRappen: number;
  tipRappen: number;
  roundingRappen: number;
  /** Local hour of the refund. */
  hour: number;
  /** Of the order of the refunded payment. */
  waiterUserId: string | null;
  channel: Channel;
  tipUserId: string | null;
  paymentAmountRappen: number;
  paymentTaxes: readonly TaxSummaryLine[];
}

export interface MoneyInput {
  payments: readonly ReportPayment[];
  refunds: readonly ReportRefund[];
}

export interface BreakdownLine<K extends string | number | null = string> {
  key: K;
  /** Sales net of refunds (MWST included). */
  salesRappen: number;
  paymentCount: number;
  refundCount: number;
}

export interface SalesReport {
  /** = the sum of the Zs of the period (`grossSalesRappen`). */
  salesRappen: number;
  tipsRappen: number;
  roundingRappen: number;
  paymentCount: number;
  refundCount: number;
  refundsRappen: number;
  byDay: BreakdownLine<IsoDate>[];
  /** 24 lines, hour 0 to 23. */
  byHour: BreakdownLine<number>[];
  byWaiter: BreakdownLine<string | null>[];
  byChannel: BreakdownLine<Channel>[];
  byMethod: BreakdownLine<PaymentMethod>[];
}

const sum = <T>(items: readonly T[], value: (item: T) => number) =>
  items.reduce((total, item) => total + value(item), 0);

/** Sales by one key; each breakdown adds up to the total. Biggest first unless `order`. */
function breakdown<K extends string | number | null>(
  input: MoneyInput,
  keyOf: (money: ReportPayment | ReportRefund) => K,
  order?: (a: K, b: K) => number,
): BreakdownLine<K>[] {
  const lines = new Map<K, BreakdownLine<K>>();
  const lineOf = (key: K) => {
    let line = lines.get(key);
    if (!line) {
      line = { key, salesRappen: 0, paymentCount: 0, refundCount: 0 };
      lines.set(key, line);
    }
    return line;
  };
  for (const payment of input.payments) {
    const line = lineOf(keyOf(payment));
    line.salesRappen += payment.amountRappen;
    line.paymentCount += 1;
  }
  for (const refund of input.refunds) {
    const line = lineOf(keyOf(refund));
    line.salesRappen -= refund.amountRappen;
    line.refundCount += 1;
  }
  const result = [...lines.values()];
  return order
    ? result.sort((a, b) => order(a.key, b.key))
    : result.sort((a, b) => b.salesRappen - a.salesRappen);
}

/** Sales of a period by day, hour, waiter, channel and payment method (RF-F01). */
export function salesReport(input: MoneyInput): SalesReport {
  const byHour = breakdown(
    input,
    (money) => money.hour,
    (a, b) => a - b,
  );
  return {
    salesRappen:
      sum(input.payments, (p) => p.amountRappen) - sum(input.refunds, (r) => r.amountRappen),
    tipsRappen: sum(input.payments, (p) => p.tipRappen) - sum(input.refunds, (r) => r.tipRappen),
    roundingRappen:
      sum(input.payments, (p) => p.roundingRappen) - sum(input.refunds, (r) => r.roundingRappen),
    paymentCount: input.payments.length,
    refundCount: input.refunds.length,
    refundsRappen: sum(input.refunds, (r) => r.amountRappen),
    byDay: breakdown(
      input,
      (money) => money.businessDate,
      (a, b) => a.localeCompare(b),
    ),
    byHour: Array.from(
      { length: 24 },
      (_, hour) =>
        byHour.find((line) => line.key === hour) ?? {
          key: hour,
          salesRappen: 0,
          paymentCount: 0,
          refundCount: 0,
        },
    ),
    byWaiter: breakdown(input, (money) => money.waiterUserId),
    byChannel: breakdown(input, (money) => money.channel),
    byMethod: breakdown(
      input,
      (money) => money.method,
      (a, b) => PAYMENT_METHODS.indexOf(a) - PAYMENT_METHODS.indexOf(b),
    ),
  };
}

/** The change of a figure against the previous period, in per mille (null without a base). */
export function changePerMille(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) * 1000) / Math.abs(previous));
}

export interface VatPeriod {
  key: string;
  byTaxRate: TaxSummaryLine[];
  grossRappen: number;
  taxRappen: number;
  netRappen: number;
}

export interface VatReport {
  periods: VatPeriod[];
  /** The whole period by rate: = the sum of the Zs' `byTaxRate`. */
  byTaxRate: TaxSummaryLine[];
  grossRappen: number;
  taxRappen: number;
  netRappen: number;
}

const vatPeriod = (key: string, byTaxRate: TaxSummaryLine[]): VatPeriod => ({
  key,
  byTaxRate,
  grossRappen: sum(byTaxRate, (rate) => rate.grossRappen),
  taxRappen: sum(byTaxRate, (rate) => rate.taxRappen),
  netRappen: sum(byTaxRate, (rate) => rate.netRappen),
});

/**
 * MWST by rate and period (RF-F02): turnover (gross), tax and net per rate, by day, month,
 * quarter, half-year or year, for the MWST return. Net of refunds, like the Z.
 */
export function vatReport(input: MoneyInput, granularity: VatGranularity): VatReport {
  const keys = new Set<string>();
  for (const money of [...input.payments, ...input.refunds]) {
    keys.add(periodKey(money.businessDate, granularity));
  }
  const periods = [...keys].sort().map((key) => {
    const inPeriod = (money: { businessDate: IsoDate }) =>
      periodKey(money.businessDate, granularity) === key;
    return vatPeriod(
      key,
      netTaxes(input.payments.filter(inPeriod), input.refunds.filter(inPeriod)),
    );
  });
  const total = vatPeriod('', netTaxes(input.payments, input.refunds));
  return {
    periods,
    byTaxRate: total.byTaxRate,
    grossRappen: total.grossRappen,
    taxRappen: total.taxRappen,
    netRappen: total.netRappen,
  };
}

export type AccountingRowKind = 'sale' | 'tip' | 'rounding';

/** One line of the accounting export (RF-F04): a day, a payment method and an MWST rate. */
export interface AccountingRow {
  businessDate: IsoDate;
  kind: AccountingRowKind;
  method: PaymentMethod;
  /** Null for tips and rounding: outside the turnover, without MWST (RN-06, RN-07). */
  rateCode: TaxRateCode | null;
  rateBp: number | null;
  grossRappen: number;
  taxRappen: number;
  netRappen: number;
}

/**
 * The generic accounting export (RF-F04): per business day and payment method, the turnover by
 * MWST rate, then the tips and the cash rounding (no MWST). Σ of the sale rows = the sales of the
 * Zs; Σ of all rows = what the drawers and terminals took.
 */
export function accountingRows(input: MoneyInput): AccountingRow[] {
  const sales = new Map<string, AccountingRow>();
  const extras = new Map<string, AccountingRow>();
  const addSale = (
    day: IsoDate,
    method: PaymentMethod,
    lines: readonly TaxSummaryLine[],
    sign: 1 | -1,
  ) => {
    for (const line of lines) {
      const key = `${day}|${method}|${line.rateCode}|${line.rateBp}`;
      const row = sales.get(key) ?? {
        businessDate: day,
        kind: 'sale' as const,
        method,
        rateCode: line.rateCode,
        rateBp: line.rateBp,
        grossRappen: 0,
        taxRappen: 0,
        netRappen: 0,
      };
      row.grossRappen += sign * line.grossRappen;
      row.taxRappen += sign * line.taxRappen;
      row.netRappen += sign * line.netRappen;
      sales.set(key, row);
    }
  };
  const addExtra = (
    day: IsoDate,
    method: PaymentMethod,
    kind: 'tip' | 'rounding',
    amount: number,
  ) => {
    if (amount === 0) return;
    const key = `${day}|${method}|${kind}`;
    const row = extras.get(key) ?? {
      businessDate: day,
      kind,
      method,
      rateCode: null,
      rateBp: null,
      grossRappen: 0,
      taxRappen: 0,
      netRappen: 0,
    };
    row.grossRappen += amount;
    row.netRappen += amount;
    extras.set(key, row);
  };
  for (const payment of input.payments) {
    addSale(payment.businessDate, payment.method, payment.taxes, 1);
    addExtra(payment.businessDate, payment.method, 'tip', payment.tipRappen);
    addExtra(payment.businessDate, payment.method, 'rounding', payment.roundingRappen);
  }
  for (const refund of input.refunds) {
    addSale(refund.businessDate, refund.method, taxesOfRefund(refund), -1);
    addExtra(refund.businessDate, refund.method, 'tip', -refund.tipRappen);
    addExtra(refund.businessDate, refund.method, 'rounding', -refund.roundingRappen);
  }
  const kindOrder: Record<AccountingRowKind, number> = { sale: 0, tip: 1, rounding: 2 };
  return [...sales.values(), ...extras.values()]
    .filter((row) => row.grossRappen !== 0 || row.taxRappen !== 0)
    .sort(
      (a, b) =>
        a.businessDate.localeCompare(b.businessDate) ||
        PAYMENT_METHODS.indexOf(a.method) - PAYMENT_METHODS.indexOf(b.method) ||
        kindOrder[a.kind] - kindOrder[b.kind] ||
        (b.rateBp ?? 0) - (a.rateBp ?? 0),
    );
}

export interface TipLine {
  userId: string | null;
  tipsRappen: number;
  count: number;
}

/**
 * Tips by person (RF-F07), outside the sales and without MWST (RN-07): the tip of each payment
 * to whom it was given, minus refunded tips. Σ = the tips of the Zs.
 */
export function tipsReport(input: MoneyInput): { tipsRappen: number; byPerson: TipLine[] } {
  const people = new Map<string | null, TipLine>();
  const add = (userId: string | null, amount: number, count: number) => {
    if (amount === 0) return;
    const line = people.get(userId) ?? { userId, tipsRappen: 0, count: 0 };
    line.tipsRappen += amount;
    line.count += count;
    people.set(userId, line);
  };
  for (const payment of input.payments) add(payment.tipUserId, payment.tipRappen, 1);
  for (const refund of input.refunds) add(refund.tipUserId, -refund.tipRappen, 0);
  const byPerson = [...people.values()]
    .filter((line) => line.tipsRappen !== 0)
    .sort((a, b) => b.tipsRappen - a.tipsRappen);
  return { tipsRappen: sum(byPerson, (line) => line.tipsRappen), byPerson };
}
