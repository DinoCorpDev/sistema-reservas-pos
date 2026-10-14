import type { FoldState, ShiftState } from '../orders/state';
import { movementsOfShift, paymentsOfShift, refundsOfShift } from '../orders/state';
import type { TaxSummaryLine } from '../tax/calculation';
import { type ClosingInput, closingTotals } from './closing';
import type { ShiftReport } from './report';
import { expectedCash } from './shifts';

/** Whether a discount or a void belongs to the shift: same drawer or person, inside its time. */
function ofShift(
  shift: ShiftState,
  until: string,
  fact: { at: string | null; terminalId: string | null; userId: string | null },
): boolean {
  if (fact.at === null) return false;
  const at = Date.parse(fact.at);
  if (at < Date.parse(shift.openedAt) || at > Date.parse(until)) return false;
  return shift.scope === 'terminal'
    ? fact.terminalId === shift.terminalId
    : fact.userId === shift.cashierUserId;
}

const taxesOf = (state: FoldState, receiptId: string): TaxSummaryLine[] =>
  (state.receipts.get(receiptId)?.content.taxes ?? []) as TaxSummaryLine[];

/**
 * The report of a shift at `until` (X while it runs, the closing report at its close, RF-D15),
 * built from the fold with the same arithmetic as the Z (`closingTotals`), so the shift reports
 * of a day add up to its Z. Pure: the device freezes it in `shift.close`.
 */
export function shiftReport(
  state: FoldState,
  shiftId: string,
  options: { until: string; ownerName: string; timeZone: string },
): ShiftReport {
  const shift = state.shifts.get(shiftId);
  if (!shift) throw new Error(`Unknown shift ${shiftId}`);
  const payments = paymentsOfShift(state, shiftId);
  const refunds = refundsOfShift(state, shiftId);
  const movements = movementsOfShift(state, shiftId);
  const discounts = [...state.discounts.values()].filter(
    (d) =>
      d.removedAt === null &&
      ofShift(shift, options.until, {
        at: d.appliedAt,
        terminalId: d.terminalId,
        userId: d.appliedByUserId,
      }),
  );
  const voids = [...state.items.values()].filter(
    (item) =>
      item.prepStatus === 'voided' &&
      ofShift(shift, options.until, {
        at: item.voidedAt,
        terminalId: item.voidedTerminalId,
        userId: item.voidedByUserId,
      }),
  );
  const input: ClosingInput = {
    payments: payments.map((p) => ({
      method: p.method,
      amountRappen: p.amountRappen,
      tipRappen: p.tipRappen,
      roundingRappen: p.roundingRappen,
      shiftId,
      taxes: taxesOf(state, p.receiptId),
    })),
    refunds: refunds.map((r) => {
      const paid = state.payments.get(r.paymentId);
      return {
        method: r.method,
        amountRappen: r.amountRappen,
        tipRappen: r.tipRappen,
        roundingRappen: r.roundingRappen,
        shiftId,
        paymentAmountRappen: paid?.amountRappen ?? r.amountRappen,
        paymentTaxes: paid ? taxesOf(state, paid.receiptId) : [],
      };
    }),
    movements: movements.map((m) => ({ kind: m.kind, amountRappen: m.amountRappen, shiftId })),
    shifts: [],
    orders: [
      {
        discountRappen: discounts.reduce((sum, d) => sum + d.amountRappen, 0),
        discountCount: discounts.length,
      },
    ],
    voids: voids.map((item) => ({ grossRappen: item.grossRappen })),
    reconciliations: [],
  };
  const totals = closingTotals(input);
  const refundLines = new Map<string, ShiftReport['refunds'][number]>();
  for (const refund of refunds) {
    const line = refundLines.get(refund.method) ?? {
      method: refund.method,
      count: 0,
      amountRappen: 0,
      tipRappen: 0,
      roundingRappen: 0,
      paidOutRappen: 0,
    };
    line.count += 1;
    line.amountRappen += refund.amountRappen;
    line.tipRappen += refund.tipRappen;
    line.roundingRappen += refund.roundingRappen;
    line.paidOutRappen += refund.amountRappen + refund.tipRappen + refund.roundingRappen;
    refundLines.set(refund.method, line);
  }
  const paymentLines = new Map<string, ShiftReport['payments'][number]>();
  for (const payment of payments) {
    const line = paymentLines.get(payment.method) ?? {
      method: payment.method,
      count: 0,
      amountRappen: 0,
      tipRappen: 0,
      roundingRappen: 0,
      collectedRappen: 0,
    };
    line.count += 1;
    line.amountRappen += payment.amountRappen;
    line.tipRappen += payment.tipRappen;
    line.roundingRappen += payment.roundingRappen;
    line.collectedRappen += payment.amountRappen + payment.tipRappen + payment.roundingRappen;
    paymentLines.set(payment.method, line);
  }
  const order = (method: string) => totals.byPaymentMethod.findIndex((m) => m.method === method);
  return {
    version: 1,
    scope: shift.scope,
    ownerName: options.ownerName,
    businessDate: shift.businessDate,
    openedAt: shift.openedAt,
    closedAt: options.until,
    timeZone: options.timeZone,
    payments: [...paymentLines.values()].sort((a, b) => order(a.method) - order(b.method)),
    refunds: [...refundLines.values()].sort((a, b) => order(a.method) - order(b.method)),
    taxes: totals.byTaxRate,
    discountsRappen: totals.discountsRappen,
    discountCount: totals.discountCount,
    voidsRappen: totals.voidsRappen,
    voidCount: totals.voidCount,
    movements: Object.entries(totals.cash.movementsByKind)
      .map(([kind, amountRappen]) => ({
        kind: kind as ShiftReport['movements'][number]['kind'],
        count: movements.filter((m) => m.kind === kind).length,
        amountRappen,
      }))
      .filter((m) => m.count > 0),
    cash: {
      openingFloatRappen: shift.openingFloatRappen,
      collectedRappen: totals.cash.collectedRappen,
      paidOutRappen: totals.cash.paidOutRappen,
      movementsRappen: totals.cash.movementsRappen,
      expectedRappen: expectedCash({
        openingFloatRappen: shift.openingFloatRappen,
        payments,
        refunds,
        movements,
      }),
    },
  };
}
