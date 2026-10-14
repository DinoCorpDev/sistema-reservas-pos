import { PAYMENT_METHODS, type PaymentMethod } from '../payments/constants';
import { refundTaxes } from '../receipts/build';
import { type Rappen, rappen } from '../shared/money';
import type { TaxSummaryLine } from '../tax/calculation';
import { CASH_MOVEMENT_KINDS, type CashMovementKind, type ShiftScope } from './constants';

/**
 * The Z closing of a business day (RF-D15, DEC-038): money and MWST come from the payments and
 * their receipts, net of refunds, so the closing matches what was collected to the rappen.
 * Pure: the cloud reads the rows of the day and the same function computes the preview and the
 * frozen totals. Amounts in rappen.
 */

export interface ClosingPayment {
  method: PaymentMethod;
  amountRappen: number;
  tipRappen: number;
  roundingRappen: number;
  /** Without a shift: cash of version 2 operations, outside any drawer count. */
  shiftId: string | null;
  /** MWST of the receipt of this payment (DEC-024). */
  taxes: readonly TaxSummaryLine[];
}

export interface ClosingRefund {
  method: PaymentMethod;
  amountRappen: number;
  tipRappen: number;
  roundingRappen: number;
  shiftId: string | null;
  /** The payment refunded: its sale amount and its receipt's MWST. */
  paymentAmountRappen: number;
  paymentTaxes: readonly TaxSummaryLine[];
}

export interface ClosingShift {
  id: string;
  scope: ShiftScope;
  ownerName: string;
  status: 'open' | 'closed';
  openingFloatRappen: number;
  /** Frozen by the device at the close; null while open. */
  expectedCashRappen: number | null;
  countedCashRappen: number | null;
  differenceRappen: number | null;
  differenceComment: string | null;
}

export interface ClosingInput {
  payments: readonly ClosingPayment[];
  refunds: readonly ClosingRefund[];
  movements: readonly { kind: CashMovementKind; amountRappen: number; shiftId: string | null }[];
  shifts: readonly ClosingShift[];
  /** Orders of the day (not voided): how many, and their discounts. */
  orders: readonly { discountRappen: number; discountCount: number }[];
  /** Items voided during the day: their gross value. */
  voids: readonly { grossRappen: number }[];
  reconciliations: readonly ClosingReconciliation[];
}

export interface ClosingReconciliation {
  method: PaymentMethod;
  /** What the POS took through the method (collected − paid back). */
  posTotalRappen: number;
  /** What the payment terminal's own closing says (RF-D11). */
  terminalTotalRappen: number;
  differenceRappen: number;
  reason: string | null;
}

export interface ClosingMethodLine {
  method: PaymentMethod;
  paymentCount: number;
  refundCount: number;
  /** Sale part, net of refunds. */
  salesRappen: number;
  tipsRappen: number;
  roundingRappen: number;
  /** Collected − paid back: what the drawer or the terminal holds for this method. */
  totalRappen: number;
}

export interface DailyClosingTotals {
  version: 1;
  /** Sales net of refunds: the turnover (MWST included). */
  grossSalesRappen: number;
  byPaymentMethod: ClosingMethodLine[];
  byTaxRate: TaxSummaryLine[];
  tipsRappen: number;
  roundingRappen: number;
  refundsRappen: number;
  refundCount: number;
  paymentCount: number;
  discountsRappen: number;
  discountCount: number;
  voidsRappen: number;
  voidCount: number;
  orderCount: number;
  cash: {
    openingFloatRappen: number;
    collectedRappen: number;
    paidOutRappen: number;
    movementsRappen: number;
    movementsByKind: Record<CashMovementKind, number>;
    /** Σ of the expected cash the cashiers signed at their closes. */
    expectedRappen: number;
    countedRappen: number;
    differenceRappen: number;
    /** Cash recorded without a shift (operations from before shifts). */
    unassignedRappen: number;
  };
  shifts: ClosingShift[];
  reconciliations: ClosingReconciliation[];
}

/** Money that moved: sale + tip + rounding (collected by a payment, paid out by a refund). */
const moved = (m: { amountRappen: number; tipRappen: number; roundingRappen: number }) =>
  m.amountRappen + m.tipRappen + m.roundingRappen;

const sum = <T>(items: readonly T[], value: (item: T) => number) =>
  items.reduce((total, item) => total + value(item), 0);

/** Adds MWST lines rate by rate (highest rate first, like the receipts). */
function addTaxes(
  target: Map<string, TaxSummaryLine>,
  lines: readonly TaxSummaryLine[],
  sign: 1 | -1,
) {
  for (const line of lines) {
    const key = `${line.rateCode}:${line.rateBp}`;
    const current = target.get(key) ?? {
      rateCode: line.rateCode,
      rateBp: line.rateBp,
      grossRappen: rappen(0),
      taxRappen: rappen(0),
      netRappen: rappen(0),
    };
    target.set(key, {
      ...current,
      grossRappen: rappen(current.grossRappen + sign * line.grossRappen),
      taxRappen: rappen(current.taxRappen + sign * line.taxRappen),
      netRappen: rappen(current.netRappen + sign * line.netRappen),
    });
  }
}

/** The frozen totals of a Z (RF-D15). */
export function closingTotals(input: ClosingInput): DailyClosingTotals {
  const byMethod = new Map<PaymentMethod, ClosingMethodLine>();
  const line = (method: PaymentMethod) => {
    let current = byMethod.get(method);
    if (!current) {
      current = {
        method,
        paymentCount: 0,
        refundCount: 0,
        salesRappen: 0,
        tipsRappen: 0,
        roundingRappen: 0,
        totalRappen: 0,
      };
      byMethod.set(method, current);
    }
    return current;
  };
  const taxes = new Map<string, TaxSummaryLine>();
  for (const payment of input.payments) {
    const current = line(payment.method);
    current.paymentCount += 1;
    current.salesRappen += payment.amountRappen;
    current.tipsRappen += payment.tipRappen;
    current.roundingRappen += payment.roundingRappen;
    current.totalRappen += moved(payment);
    addTaxes(taxes, payment.taxes, 1);
  }
  for (const refund of input.refunds) {
    const current = line(refund.method);
    current.refundCount += 1;
    current.salesRappen -= refund.amountRappen;
    current.tipsRappen -= refund.tipRappen;
    current.roundingRappen -= refund.roundingRappen;
    current.totalRappen -= moved(refund);
    addTaxes(
      taxes,
      refundTaxes(
        refund.paymentTaxes,
        rappen(refund.paymentAmountRappen),
        rappen(refund.amountRappen),
      ),
      -1,
    );
  }
  const methods = PAYMENT_METHODS.flatMap((method) => byMethod.get(method) ?? []);
  const byTaxRate = [...taxes.values()]
    .filter((rate) => rate.grossRappen !== 0 || rate.taxRappen !== 0)
    .sort((a, b) => b.rateBp - a.rateBp);

  const isCash = (money: { method: PaymentMethod }) => money.method === 'cash';
  const cashPayments = input.payments.filter(isCash);
  const cashRefunds = input.refunds.filter(isCash);
  const movementsByKind = Object.fromEntries(
    CASH_MOVEMENT_KINDS.map((kind) => [
      kind,
      sum(
        input.movements.filter((m) => m.kind === kind),
        (m) => m.amountRappen,
      ),
    ]),
  ) as Record<CashMovementKind, number>;
  const closed = input.shifts.filter((shift) => shift.status === 'closed');

  return {
    version: 1,
    grossSalesRappen: sum(methods, (m) => m.salesRappen),
    byPaymentMethod: methods,
    byTaxRate,
    tipsRappen: sum(methods, (m) => m.tipsRappen),
    roundingRappen: sum(methods, (m) => m.roundingRappen),
    refundsRappen: sum(input.refunds, (r) => r.amountRappen),
    refundCount: input.refunds.length,
    paymentCount: input.payments.length,
    discountsRappen: sum(input.orders, (o) => o.discountRappen),
    discountCount: sum(input.orders, (o) => o.discountCount),
    voidsRappen: sum(input.voids, (v) => v.grossRappen),
    voidCount: input.voids.length,
    orderCount: input.orders.length,
    cash: {
      openingFloatRappen: sum(input.shifts, (s) => s.openingFloatRappen),
      collectedRappen: sum(cashPayments, (p) => moved(p)),
      paidOutRappen: sum(cashRefunds, (r) => moved(r)),
      movementsRappen: sum(input.movements, (m) => m.amountRappen),
      movementsByKind,
      expectedRappen: sum(closed, (s) => s.expectedCashRappen ?? 0),
      countedRappen: sum(closed, (s) => s.countedCashRappen ?? 0),
      differenceRappen: sum(closed, (s) => s.differenceRappen ?? 0),
      unassignedRappen:
        sum(
          cashPayments.filter((p) => p.shiftId === null),
          (p) => moved(p),
        ) -
        sum(
          cashRefunds.filter((r) => r.shiftId === null),
          (r) => moved(r),
        ),
    },
    shifts: input.shifts.map((shift) => ({ ...shift })),
    reconciliations: input.reconciliations.map((r) => ({ ...r })),
  };
}

/** What the POS took through each method: the figure the payment terminal is compared with. */
export const posTotalsByMethod = (totals: Pick<DailyClosingTotals, 'byPaymentMethod'>) =>
  new Map(totals.byPaymentMethod.map((m) => [m.method, m.totalRappen as Rappen]));
