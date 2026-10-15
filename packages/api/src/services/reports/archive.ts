import type { DailyClosingTotals, ReportPeriod, TaxSummaryLine } from '@pos/core';
import { inLocation, notDeleted, schema as s } from '@pos/db';
import { and, asc, between, eq } from 'drizzle-orm';
import type { Actor } from '../../actor';
import { getCashBook } from '../cash/day-close';
import type { ServiceDeps } from '../shared';
import { reportContext, userNames } from './context';

/**
 * The archive of a period (RF-F13, RNF-15): receipts, Z closings and cash books as they were
 * stored, for the fiduciary and the ten-year retention. Read only, in business-day order.
 */

export interface ReceiptArchiveRow {
  receiptNumber: string;
  copyNumber: number;
  issuedAt: string;
  businessDate: string | null;
  orderNumber: string;
  method: string;
  amountRappen: number;
  tipRappen: number;
  roundingRappen: number;
  taxes: TaxSummaryLine[];
  issuedBy: string | null;
  contentHash: string;
  /** The receipt exactly as issued (DEC-024). */
  content: unknown;
}

/** Every receipt (originals and copies) of the payments of the period. */
export async function archiveReceipts(
  deps: ServiceDeps,
  actor: Actor,
  period: ReportPeriod,
): Promise<{ period: ReportPeriod; receipts: ReceiptArchiveRow[] }> {
  const context = await reportContext(deps, actor);
  const [rows, names] = await Promise.all([
    context.db
      .select({
        receiptNumber: s.receipts.receiptNumber,
        copyNumber: s.receipts.copyNumber,
        issuedAt: s.receipts.issuedAt,
        content: s.receipts.content,
        contentHash: s.receipts.contentHash,
        issuedByUserId: s.receipts.issuedByUserId,
        businessDate: s.payments.businessDate,
        method: s.payments.method,
        amountRappen: s.payments.amountRappen,
        tipRappen: s.payments.tipRappen,
        roundingRappen: s.payments.roundingRappen,
        orderNumber: s.orders.displayNumber,
      })
      .from(s.receipts)
      .innerJoin(s.payments, eq(s.payments.id, s.receipts.paymentId))
      .innerJoin(s.orders, eq(s.orders.id, s.receipts.orderId))
      .where(
        inLocation(
          s.receipts,
          context.tenant,
          between(s.payments.businessDate, period.from, period.to),
        ),
      )
      .orderBy(asc(s.receipts.issuedAt), asc(s.receipts.receiptNumber), asc(s.receipts.copyNumber)),
    userNames(context.db, context.tenant),
  ]);
  return {
    period,
    receipts: rows.map((row) => ({
      receiptNumber: row.receiptNumber,
      copyNumber: row.copyNumber,
      issuedAt: row.issuedAt.toISOString(),
      businessDate: row.businessDate,
      orderNumber: row.orderNumber,
      method: row.method,
      amountRappen: row.amountRappen,
      tipRappen: row.tipRappen,
      roundingRappen: row.roundingRappen,
      taxes: ((row.content as { taxes?: TaxSummaryLine[] } | null)?.taxes ?? []).map((t) => ({
        ...t,
      })),
      issuedBy: row.issuedByUserId ? (names[row.issuedByUserId] ?? null) : null,
      contentHash: row.contentHash,
      content: row.content,
    })),
  };
}

export interface ClosingArchiveRow {
  businessDate: string;
  closingNumber: number;
  closedAt: string;
  closedBy: string | null;
  contentHash: string;
  totals: DailyClosingTotals;
}

/** The Z closings of the period, oldest first, with their sealed totals (RF-F03). */
export async function archiveClosings(
  deps: ServiceDeps,
  actor: Actor,
  period: ReportPeriod,
): Promise<{ period: ReportPeriod; closings: ClosingArchiveRow[] }> {
  const context = await reportContext(deps, actor);
  const [rows, names] = await Promise.all([
    context.db
      .select()
      .from(s.dailyClosings)
      .where(
        and(
          eq(s.dailyClosings.organizationId, context.tenant.organizationId),
          eq(s.dailyClosings.locationId, context.tenant.locationId),
          between(s.dailyClosings.businessDate, period.from, period.to),
        ),
      )
      .orderBy(asc(s.dailyClosings.businessDate)),
    userNames(context.db, context.tenant),
  ]);
  return {
    period,
    closings: rows.map((row) => ({
      businessDate: row.businessDate,
      closingNumber: row.closingNumber,
      closedAt: row.closedAt.toISOString(),
      closedBy: names[row.closedByUserId] ?? null,
      contentHash: row.contentHash,
      totals: row.totals as DailyClosingTotals,
    })),
  };
}

/** The cash books (RF-D16) of the days of the period that had a shift or cash. */
export async function archiveCashBooks(deps: ServiceDeps, actor: Actor, period: ReportPeriod) {
  const context = await reportContext(deps, actor);
  const { db, tenant } = context;
  const [shiftDays, cashDays, movementDays] = await Promise.all([
    db
      .selectDistinct({ day: s.shifts.businessDate })
      .from(s.shifts)
      .where(
        inLocation(
          s.shifts,
          tenant,
          between(s.shifts.businessDate, period.from, period.to),
          notDeleted(s.shifts),
        ),
      ),
    db
      .selectDistinct({ day: s.payments.businessDate })
      .from(s.payments)
      .where(
        inLocation(
          s.payments,
          tenant,
          between(s.payments.businessDate, period.from, period.to),
          eq(s.payments.method, 'cash'),
          notDeleted(s.payments),
        ),
      ),
    db
      .selectDistinct({ day: s.cashMovements.businessDate })
      .from(s.cashMovements)
      .where(
        inLocation(
          s.cashMovements,
          tenant,
          between(s.cashMovements.businessDate, period.from, period.to),
          notDeleted(s.cashMovements),
        ),
      ),
  ]);
  const days = [
    ...new Set(
      [...shiftDays, ...cashDays, ...movementDays].flatMap((row) => (row.day ? [row.day] : [])),
    ),
  ].sort();
  const books = [];
  for (const day of days) books.push(await getCashBook(deps, actor, day));
  return { period, books };
}
