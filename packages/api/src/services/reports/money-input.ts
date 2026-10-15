import {
  type Channel,
  localMoment,
  type MoneyInput,
  type PaymentMethod,
  type ReportPeriod,
  type TaxSummaryLine,
} from '@pos/core';
import { inLocation, notDeleted, schema as s } from '@pos/db';
import { between, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/mysql-core';
import { chunks, type ReportContext } from './context';

/**
 * The money of a period as the Z counts it (DEC-038): completed payments of its business days
 * and the refunds of those days, each with the MWST of its receipt, the order's waiter and channel
 * and who got the tip. One query for each list, plus the receipts' MWST in chunks.
 */

const taxesOf = (value: unknown): TaxSummaryLine[] => {
  const parsed = typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
  return Array.isArray(parsed) ? (parsed as TaxSummaryLine[]).map((line) => ({ ...line })) : [];
};

const hourOf = (at: Date | null, timeZone: string) =>
  at ? Number(localMoment(at, timeZone).time.slice(0, 2)) : 0;

/** The MWST of the original receipt of each payment. */
async function receiptTaxes(context: ReportContext, paymentIds: readonly string[]) {
  const taxes = new Map<string, TaxSummaryLine[]>();
  for (const ids of chunks([...new Set(paymentIds)])) {
    const rows = await context.db
      .select({
        paymentId: s.receipts.paymentId,
        // Only the MWST of the stored receipt, not its lines (DEC-024).
        taxes: sql<unknown>`json_extract(${s.receipts.content}, '$.taxes')`,
      })
      .from(s.receipts)
      .where(
        inLocation(
          s.receipts,
          context.tenant,
          inArray(s.receipts.paymentId, ids),
          eq(s.receipts.copyNumber, 0),
        ),
      );
    for (const row of rows) {
      if (row.paymentId) taxes.set(row.paymentId, taxesOf(row.taxes));
    }
  }
  return taxes;
}

export async function loadMoney(context: ReportContext, period: ReportPeriod): Promise<MoneyInput> {
  const { db, tenant, timezone } = context;
  const payments = await db
    .select({
      id: s.payments.id,
      businessDate: s.payments.businessDate,
      method: s.payments.method,
      amountRappen: s.payments.amountRappen,
      tipRappen: s.payments.tipRappen,
      roundingRappen: s.payments.roundingRappen,
      completedAt: s.payments.completedAt,
      createdAt: s.payments.createdAt,
      userId: s.payments.userId,
      waiterUserId: s.orders.waiterUserId,
      channel: s.orders.channel,
      tipUserId: s.tips.userId,
    })
    .from(s.payments)
    .innerJoin(s.orders, eq(s.orders.id, s.payments.orderId))
    .leftJoin(s.tips, eq(s.tips.id, s.payments.id))
    .where(
      inLocation(
        s.payments,
        tenant,
        between(s.payments.businessDate, period.from, period.to),
        eq(s.payments.status, 'completed'),
        notDeleted(s.payments),
      ),
    );

  const refunded = alias(s.payments, 'refunded_payment');
  const refunds = await db
    .select({
      paymentId: s.refunds.paymentId,
      businessDate: s.refunds.businessDate,
      method: s.refunds.method,
      amountRappen: s.refunds.amountRappen,
      tipRappen: s.refunds.tipRappen,
      roundingRappen: s.refunds.roundingRappen,
      refundedAt: s.refunds.refundedAt,
      paymentAmountRappen: refunded.amountRappen,
      paymentUserId: refunded.userId,
      waiterUserId: s.orders.waiterUserId,
      channel: s.orders.channel,
      tipUserId: s.tips.userId,
    })
    .from(s.refunds)
    .innerJoin(refunded, eq(refunded.id, s.refunds.paymentId))
    .innerJoin(s.orders, eq(s.orders.id, s.refunds.orderId))
    .leftJoin(s.tips, eq(s.tips.id, s.refunds.paymentId))
    .where(
      inLocation(
        s.refunds,
        tenant,
        between(s.refunds.businessDate, period.from, period.to),
        notDeleted(s.refunds),
      ),
    );

  const taxes = await receiptTaxes(context, [
    ...payments.map((p) => p.id),
    ...refunds.map((r) => r.paymentId),
  ]);
  return {
    payments: payments.flatMap((payment) =>
      payment.businessDate
        ? [
            {
              businessDate: payment.businessDate,
              method: payment.method as PaymentMethod,
              amountRappen: payment.amountRappen,
              tipRappen: payment.tipRappen,
              roundingRappen: payment.roundingRappen,
              hour: hourOf(payment.completedAt ?? payment.createdAt, timezone),
              waiterUserId: payment.waiterUserId,
              channel: payment.channel as Channel,
              tipUserId: payment.tipUserId ?? (payment.tipRappen > 0 ? payment.userId : null),
              taxes: taxes.get(payment.id) ?? [],
            },
          ]
        : [],
    ),
    refunds: refunds.flatMap((refund) =>
      refund.businessDate
        ? [
            {
              businessDate: refund.businessDate,
              method: refund.method as PaymentMethod,
              amountRappen: refund.amountRappen,
              tipRappen: refund.tipRappen,
              roundingRappen: refund.roundingRappen,
              hour: hourOf(refund.refundedAt, timezone),
              waiterUserId: refund.waiterUserId,
              channel: refund.channel as Channel,
              tipUserId: refund.tipUserId ?? (refund.tipRappen > 0 ? refund.paymentUserId : null),
              paymentAmountRappen: refund.paymentAmountRappen,
              paymentTaxes: taxes.get(refund.paymentId) ?? [],
            },
          ]
        : [],
    ),
  };
}

/** Same period, nothing but the sales figure (the comparison with the previous period). */
export async function salesOf(context: ReportContext, period: ReportPeriod): Promise<number> {
  const money = await loadMoney(context, period);
  return (
    money.payments.reduce((total, p) => total + p.amountRappen, 0) -
    money.refunds.reduce((total, r) => total + r.amountRappen, 0)
  );
}
