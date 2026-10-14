import {
  businessDate as businessDateOf,
  type CashBook,
  cashBook,
  type CashBookEntry,
  type CashMovementKind,
  type ClosingInput,
  type ClosingReconciliation,
  type ClosingShift,
  closingTotals,
  contentHash,
  type DailyClosingTotals,
  dayCloseSchema,
  parseLocationSettings,
  type PaymentMethod,
  type ShiftScope,
  type TaxSummaryLine,
} from '@pos/core';
import { inLocation, notDeleted, runCommand, schema as s, type Transaction } from '@pos/db';
import { and, asc, desc, eq, gt, inArray, isNull, lt, lte, max, ne, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { type Actor, assertPermission, requireLocationId, requireUserId } from '../../actor';
import { ApiError, isDuplicateKey } from '../../errors';
import type { ServiceDeps } from '../shared';

/**
 * Closing the business day (Z, RF-D11, RF-D15…RF-D17, RF-D19, RN-20, RN-21, DEC-038). The same
 * service answers the POS (a manager's PIN session) and the backoffice. The Z is computed from
 * the money of the day, frozen with its hash and never changed: what arrives later shows as a
 * correction of it.
 */

type Db = ServiceDeps['db'] | Transaction;
type Tenant = { organizationId: string; locationId: string };

export interface DayCloseBlockers {
  /** Shifts of this day or before still open (RN-20). */
  openShifts: { id: string; scope: ShiftScope; ownerName: string; businessDate: string }[];
  /** Orders of the day still open (RF-D19): to pay, void or move. */
  openOrders: {
    id: string;
    displayNumber: string;
    tableId: string | null;
    totalRappen: number;
    balanceRappen: number;
  }[];
  /** An earlier day with activity and no Z: days close in order. */
  previousDayOpen: string | null;
  /** A day that has not started yet cannot close. */
  future: boolean;
}

export interface DayClosePreview {
  businessDate: string;
  closing: ClosingDto | null;
  blockers: DayCloseBlockers;
  canClose: boolean;
  totals: DailyClosingTotals;
  /** What the POS took per method paid through a payment terminal, to compare (RF-D11). */
  toReconcile: { method: PaymentMethod; posTotalRappen: number }[];
  warnings: { unresolvedConflicts: number; unassignedCashRappen: number };
}

export interface ClosingDto {
  id: string;
  businessDate: string;
  closingNumber: number;
  totals: DailyClosingTotals;
  contentHash: string;
  closedByUserId: string;
  closedByName: string | null;
  closedAt: string;
}

export interface ClosingDetail extends ClosingDto {
  /** Money of the day that arrived after the Z (RN-21): never inside it, always shown with it. */
  corrections: { count: number; totals: DailyClosingTotals } | null;
  /** The hash recomputed from the stored content matches (RN-10). */
  intact: boolean;
}

const tenantOf = (actor: Actor): Tenant => ({
  organizationId: actor.organizationId,
  locationId: requireLocationId(actor),
});

async function locationOf(db: Db, tenant: Tenant) {
  const [location] = await db
    .select({ timezone: s.locations.timezone, settings: s.locations.settings })
    .from(s.locations)
    .where(
      and(
        eq(s.locations.id, tenant.locationId),
        eq(s.locations.organizationId, tenant.organizationId),
      ),
    );
  if (!location) throw new ApiError('NOT_FOUND', 'Location not found');
  return { timezone: location.timezone, settings: parseLocationSettings(location.settings) };
}

/** Today's business day at the location (DEC-022). */
async function today(db: Db, tenant: Tenant): Promise<string> {
  const { timezone, settings } = await locationOf(db, tenant);
  return businessDateOf(new Date(), timezone, settings.businessDayStartsAt);
}

/** Names of terminals and people, for shift owners and closings. */
async function namesOf(db: Db, tenant: Tenant) {
  const [terminals, users] = await Promise.all([
    db
      .select({ id: s.terminals.id, name: s.terminals.name })
      .from(s.terminals)
      .where(eq(s.terminals.locationId, tenant.locationId)),
    db
      .select({ id: s.users.id, name: s.users.displayName })
      .from(s.users)
      .where(eq(s.users.organizationId, tenant.organizationId)),
  ]);
  return {
    terminal: new Map(terminals.map((t) => [t.id, t.name])),
    user: new Map(users.map((u) => [u.id, u.name])),
  };
}

type Names = Awaited<ReturnType<typeof namesOf>>;

const ownerName = (
  names: Names,
  shift: { scope: string; terminalId: string | null; cashierUserId: string | null },
) =>
  (shift.scope === 'personal'
    ? names.user.get(shift.cashierUserId ?? '')
    : names.terminal.get(shift.terminalId ?? '')) ?? '?';

const taxesOf = (content: unknown): TaxSummaryLine[] =>
  ((content as { taxes?: TaxSummaryLine[] } | null)?.taxes ?? []).map((t) => ({ ...t }));

/**
 * The money of a business day as the Z counts it. `createdBefore` keeps what had arrived by
 * then (the Z itself); `createdAfter` takes only what came later (its corrections).
 */
async function dayInput(
  db: Db,
  tenant: Tenant,
  day: string,
  names: Names,
  window: { createdAfter?: Date } = {},
): Promise<{
  input: Omit<ClosingInput, 'reconciliations'>;
  adapters: Map<PaymentMethod, Set<string>>;
}> {
  const after = window.createdAfter;
  const payments = await db
    .select({
      id: s.payments.id,
      method: s.payments.method,
      adapter: s.payments.adapter,
      amountRappen: s.payments.amountRappen,
      tipRappen: s.payments.tipRappen,
      roundingRappen: s.payments.roundingRappen,
      shiftId: s.payments.shiftId,
    })
    .from(s.payments)
    .where(
      inLocation(
        s.payments,
        tenant,
        eq(s.payments.businessDate, day),
        eq(s.payments.status, 'completed'),
        notDeleted(s.payments),
        after ? gt(s.payments.createdAt, after) : undefined,
      ),
    );
  const refunds = await db
    .select({
      method: s.refunds.method,
      amountRappen: s.refunds.amountRappen,
      tipRappen: s.refunds.tipRappen,
      roundingRappen: s.refunds.roundingRappen,
      shiftId: s.refunds.shiftId,
      paymentId: s.refunds.paymentId,
    })
    .from(s.refunds)
    .where(
      inLocation(
        s.refunds,
        tenant,
        eq(s.refunds.businessDate, day),
        notDeleted(s.refunds),
        after ? gt(s.refunds.createdAt, after) : undefined,
      ),
    );
  // The receipt of every payment involved, and the amount of the refunded ones.
  const paymentIds = [
    ...new Set([...payments.map((p) => p.id), ...refunds.map((r) => r.paymentId)]),
  ];
  const receipts =
    paymentIds.length === 0
      ? []
      : await db
          .select({ paymentId: s.receipts.paymentId, content: s.receipts.content })
          .from(s.receipts)
          .where(
            inLocation(
              s.receipts,
              tenant,
              inArray(s.receipts.paymentId, paymentIds),
              eq(s.receipts.copyNumber, 0),
            ),
          );
  const taxesByPayment = new Map(receipts.map((r) => [r.paymentId, taxesOf(r.content)]));
  const refunded =
    refunds.length === 0
      ? []
      : await db
          .select({ id: s.payments.id, amountRappen: s.payments.amountRappen })
          .from(s.payments)
          .where(
            inLocation(
              s.payments,
              tenant,
              inArray(s.payments.id, [...new Set(refunds.map((r) => r.paymentId))]),
            ),
          );
  const paymentAmount = new Map(refunded.map((p) => [p.id, p.amountRappen]));

  const movements = await db
    .select({
      kind: s.cashMovements.kind,
      amountRappen: s.cashMovements.amountRappen,
      shiftId: s.cashMovements.shiftId,
    })
    .from(s.cashMovements)
    .where(
      inLocation(
        s.cashMovements,
        tenant,
        eq(s.cashMovements.businessDate, day),
        notDeleted(s.cashMovements),
        after ? gt(s.cashMovements.createdAt, after) : undefined,
      ),
    );

  const shifts = after
    ? []
    : await db
        .select()
        .from(s.shifts)
        .where(inLocation(s.shifts, tenant, eq(s.shifts.businessDate, day), notDeleted(s.shifts)))
        .orderBy(asc(s.shifts.openedAt));

  const orders = after
    ? []
    : await db
        .select({ id: s.orders.id, discountRappen: s.orders.discountTotalRappen })
        .from(s.orders)
        .where(
          inLocation(
            s.orders,
            tenant,
            eq(s.orders.businessDate, day),
            ne(s.orders.status, 'voided'),
            notDeleted(s.orders),
          ),
        );
  const orderIds = orders.map((o) => o.id);
  const discountCounts =
    orderIds.length === 0
      ? []
      : await db
          .select({ orderId: s.discounts.orderId, count: sql<number>`count(*)` })
          .from(s.discounts)
          .where(
            inLocation(
              s.discounts,
              tenant,
              inArray(s.discounts.orderId, orderIds),
              isNull(s.discounts.deletedAt),
            ),
          )
          .groupBy(s.discounts.orderId);
  const discountCount = new Map(discountCounts.map((d) => [d.orderId, Number(d.count)]));
  const voids = after
    ? []
    : await db
        .select({
          lineTotalRappen: s.orderItems.lineTotalRappen,
          discountRappen: s.orderItems.discountRappen,
        })
        .from(s.orderItems)
        .innerJoin(s.orders, eq(s.orders.id, s.orderItems.orderId))
        .where(
          and(
            eq(s.orderItems.locationId, tenant.locationId),
            eq(s.orders.businessDate, day),
            eq(s.orderItems.prepStatus, 'voided'),
          ),
        );

  const adapters = new Map<PaymentMethod, Set<string>>();
  for (const payment of payments) {
    const method = payment.method as PaymentMethod;
    adapters.set(method, (adapters.get(method) ?? new Set()).add(payment.adapter));
  }
  return {
    adapters,
    input: {
      payments: payments.map((p) => ({
        method: p.method as PaymentMethod,
        amountRappen: p.amountRappen,
        tipRappen: p.tipRappen,
        roundingRappen: p.roundingRappen,
        shiftId: p.shiftId,
        taxes: taxesByPayment.get(p.id) ?? [],
      })),
      refunds: refunds.map((r) => ({
        method: r.method as PaymentMethod,
        amountRappen: r.amountRappen,
        tipRappen: r.tipRappen,
        roundingRappen: r.roundingRappen,
        shiftId: r.shiftId,
        paymentAmountRappen: paymentAmount.get(r.paymentId) ?? r.amountRappen,
        paymentTaxes: taxesByPayment.get(r.paymentId) ?? [],
      })),
      movements: movements.map((m) => ({
        kind: m.kind as CashMovementKind,
        amountRappen: m.amountRappen,
        shiftId: m.shiftId,
      })),
      shifts: shifts.map((shift): ClosingShift => ({
        id: shift.id,
        scope: shift.scope as ShiftScope,
        ownerName: ownerName(names, shift),
        status: shift.status === 'closed' ? 'closed' : 'open',
        openingFloatRappen: shift.openingFloatRappen,
        expectedCashRappen: shift.expectedCashRappen,
        countedCashRappen: shift.countedCashRappen,
        differenceRappen: shift.differenceRappen,
        differenceComment: shift.differenceComment,
      })),
      orders: orders.map((o) => ({
        discountRappen: o.discountRappen,
        discountCount: discountCount.get(o.id) ?? 0,
      })),
      voids: voids.map((v) => ({ grossRappen: v.lineTotalRappen + v.discountRappen })),
    },
  };
}

async function blockersOf(
  db: Db,
  tenant: Tenant,
  day: string,
  names: Names,
): Promise<DayCloseBlockers> {
  const openShifts = await db
    .select()
    .from(s.shifts)
    .where(
      inLocation(
        s.shifts,
        tenant,
        eq(s.shifts.status, 'open'),
        lte(s.shifts.businessDate, day),
        notDeleted(s.shifts),
      ),
    )
    .orderBy(asc(s.shifts.openedAt));
  const openOrders = await db
    .select({
      id: s.orders.id,
      displayNumber: s.orders.displayNumber,
      tableId: s.orders.tableId,
      totalRappen: s.orders.totalRappen,
      paidRappen: s.orders.paidTotalRappen,
    })
    .from(s.orders)
    .where(
      inLocation(
        s.orders,
        tenant,
        eq(s.orders.businessDate, day),
        eq(s.orders.status, 'open'),
        // Unresolved = money still owed. An order paid in full whose items were never marked
        // served is settled for the Z.
        gt(s.orders.totalRappen, s.orders.paidTotalRappen),
        notDeleted(s.orders),
      ),
    )
    .orderBy(asc(s.orders.openedAt));
  // Days close in order: an earlier day with money and no Z (only once a first Z exists).
  const [last] = await db
    .select({ day: max(s.dailyClosings.businessDate) })
    .from(s.dailyClosings)
    .where(eq(s.dailyClosings.locationId, tenant.locationId));
  let previousDayOpen: string | null = null;
  if (last?.day && last.day < day) {
    const [earlier] = await db
      .select({ day: s.payments.businessDate })
      .from(s.payments)
      .where(
        inLocation(
          s.payments,
          tenant,
          gt(s.payments.businessDate, last.day),
          lt(s.payments.businessDate, day),
          notDeleted(s.payments),
        ),
      )
      .orderBy(asc(s.payments.businessDate))
      .limit(1);
    previousDayOpen = earlier?.day ?? null;
  }
  return {
    openShifts: openShifts.map((shift) => ({
      id: shift.id,
      scope: shift.scope as ShiftScope,
      ownerName: ownerName(names, shift),
      businessDate: shift.businessDate,
    })),
    openOrders: openOrders.map((o) => ({
      id: o.id,
      displayNumber: o.displayNumber,
      tableId: o.tableId,
      totalRappen: o.totalRappen,
      balanceRappen: o.totalRappen - o.paidRappen,
    })),
    previousDayOpen,
    future: day > (await today(db, tenant)),
  };
}

const isBlocked = (b: DayCloseBlockers) =>
  b.openShifts.length > 0 || b.openOrders.length > 0 || b.previousDayOpen !== null || b.future;

/** Methods paid through a payment terminal that day: each is compared with its closing (RF-D11). */
function toReconcile(totals: DailyClosingTotals, adapters: Map<PaymentMethod, Set<string>>) {
  return totals.byPaymentMethod
    .filter((m) => m.method !== 'cash' && adapters.get(m.method)?.has('external-terminal'))
    .map((m) => ({ method: m.method, posTotalRappen: m.totalRappen }));
}

async function closingRow(db: Db, tenant: Tenant, where: ReturnType<typeof eq>) {
  const [row] = await db
    .select()
    .from(s.dailyClosings)
    .where(
      and(
        eq(s.dailyClosings.locationId, tenant.locationId),
        eq(s.dailyClosings.organizationId, tenant.organizationId),
        where,
      ),
    );
  return row ?? null;
}

const toDto = (row: typeof s.dailyClosings.$inferSelect, names: Names): ClosingDto => ({
  id: row.id,
  businessDate: row.businessDate,
  closingNumber: row.closingNumber,
  totals: row.totals,
  contentHash: row.contentHash,
  closedByUserId: row.closedByUserId,
  closedByName: names.user.get(row.closedByUserId) ?? null,
  closedAt: row.closedAt.toISOString(),
});

/** What the hash seals (RN-10): who closed what, when, with which totals. */
const sealed = (row: {
  organizationId: string;
  locationId: string;
  businessDate: string;
  closingNumber: number;
  totals: DailyClosingTotals;
  closedByUserId: string;
  closedAt: Date;
}) => ({
  organizationId: row.organizationId,
  locationId: row.locationId,
  businessDate: row.businessDate,
  closingNumber: row.closingNumber,
  totals: row.totals,
  closedByUserId: row.closedByUserId,
  closedAt: row.closedAt.toISOString(),
});

/** `GET /cash/day-close/preview`: what the Z would say, and what still stops it. */
export async function previewDayClose(
  deps: ServiceDeps,
  actor: Actor,
  day: string,
): Promise<DayClosePreview> {
  assertPermission(actor, 'day.close');
  const tenant = tenantOf(actor);
  const names = await namesOf(deps.db, tenant);
  const existing = await closingRow(deps.db, tenant, eq(s.dailyClosings.businessDate, day));
  const { input, adapters } = await dayInput(deps.db, tenant, day, names);
  const totals = closingTotals({ ...input, reconciliations: [] });
  const blockers = await blockersOf(deps.db, tenant, day, names);
  const [conflicts] = await deps.db
    .select({ count: sql<number>`count(*)` })
    .from(s.syncOperations)
    .where(
      and(
        eq(s.syncOperations.locationId, tenant.locationId),
        eq(s.syncOperations.status, 'conflict'),
        isNull(s.syncOperations.resolvedAt),
      ),
    );
  return {
    businessDate: day,
    closing: existing ? toDto(existing, names) : null,
    blockers,
    canClose: !existing && !isBlocked(blockers),
    totals,
    toReconcile: toReconcile(totals, adapters),
    warnings: {
      unresolvedConflicts: Number(conflicts?.count ?? 0),
      unassignedCashRappen: totals.cash.unassignedRappen,
    },
  };
}

/**
 * `POST /cash/day-close`: the Z (RF-D15). Refused while something blocks it (RF-D19, RN-20).
 * Closing a day twice returns the closing already made. Under the location lock, so the number
 * is consecutive and no push slips in between.
 */
export async function closeDay(
  deps: ServiceDeps,
  actor: Actor,
  rawInput: z.input<typeof dayCloseSchema>,
): Promise<ClosingDto> {
  assertPermission(actor, 'day.close');
  const userId = requireUserId(actor);
  const tenant = tenantOf(actor);
  const input = dayCloseSchema.parse(rawInput);
  const day = input.businessDate;
  try {
    return await runCommand(deps.db, actor, async (tx, recorder) => {
      const [locked] = await tx
        .select({ id: s.locations.id })
        .from(s.locations)
        .where(
          and(
            eq(s.locations.id, tenant.locationId),
            eq(s.locations.organizationId, tenant.organizationId),
          ),
        )
        .for('update');
      if (!locked) throw new ApiError('NOT_FOUND', 'Location not found');
      const names = await namesOf(tx, tenant);
      const existing = await closingRow(tx, tenant, eq(s.dailyClosings.businessDate, day));
      if (existing) return toDto(existing, names);

      const blockers = await blockersOf(tx, tenant, day, names);
      if (isBlocked(blockers)) {
        throw new ApiError('CONFLICT', 'The day cannot be closed yet', {
          reason: 'blocked',
          blockers,
        });
      }
      const { input: money, adapters } = await dayInput(tx, tenant, day, names);
      const draft = closingTotals({ ...money, reconciliations: [] });
      const expected = toReconcile(draft, adapters);
      const given = new Map<PaymentMethod, (typeof input.reconciliations)[number]>(
        input.reconciliations.map((r) => [r.method, r]),
      );
      const reconciliations: ClosingReconciliation[] = [];
      for (const { method, posTotalRappen } of expected) {
        const entry = given.get(method);
        if (!entry) {
          throw new ApiError('VALIDATION_FAILED', `The terminal total for ${method} is missing`, {
            reason: 'reconciliation_missing',
            method,
          });
        }
        const difference = entry.terminalTotalRappen - posTotalRappen;
        if (difference !== 0 && !entry.reason) {
          throw new ApiError('VALIDATION_FAILED', `A difference for ${method} needs a reason`, {
            reason: 'reason_required',
            method,
            differenceRappen: difference,
          });
        }
        reconciliations.push({
          method,
          posTotalRappen,
          terminalTotalRappen: entry.terminalTotalRappen,
          differenceRappen: difference,
          reason: entry.reason,
        });
      }
      const totals = closingTotals({ ...money, reconciliations });
      const [last] = await tx
        .select({ number: max(s.dailyClosings.closingNumber) })
        .from(s.dailyClosings)
        .where(eq(s.dailyClosings.locationId, tenant.locationId));
      const closedAt = new Date();
      const row = {
        organizationId: tenant.organizationId,
        locationId: tenant.locationId,
        businessDate: day,
        closingNumber: Number(last?.number ?? 0) + 1,
        totals,
        closedByUserId: userId,
        closedAt,
      };
      const hash = await contentHash(sealed(row));
      const [inserted] = await tx
        .insert(s.dailyClosings)
        .values({ ...row, contentHash: hash, createdAt: closedAt })
        .$returningId();
      const id = inserted!.id;
      if (reconciliations.length > 0) {
        await tx.insert(s.paymentReconciliations).values(
          reconciliations.map((r) => ({
            organizationId: tenant.organizationId,
            locationId: tenant.locationId,
            businessDate: day,
            method: r.method,
            posTotalRappen: r.posTotalRappen,
            terminalTotalRappen: r.terminalTotalRappen,
            differenceRappen: r.differenceRappen,
            reason: r.reason,
            userId,
            reconciledAt: closedAt,
          })),
        );
      }
      recorder.audit({
        action: 'day.closed',
        entityType: 'daily_closing',
        entityId: id,
        after: {
          businessDate: day,
          closingNumber: row.closingNumber,
          grossSalesRappen: totals.grossSalesRappen,
          cashDifferenceRappen: totals.cash.differenceRappen,
          contentHash: hash,
        },
      });
      recorder.event({
        type: 'day.closed',
        aggregateType: 'daily_closing',
        aggregateId: id,
        payload: {
          dailyClosingId: id,
          businessDate: day,
          closingNumber: row.closingNumber,
          grossSalesRappen: totals.grossSalesRappen,
          tipsRappen: totals.tipsRappen,
          contentHash: hash,
        },
        occurredAt: closedAt,
      });
      return {
        ...toDto({ id, ...row, contentHash: hash, createdAt: closedAt }, names),
      };
    });
  } catch (error) {
    // Two managers closing at once: the unique day key makes one of them win.
    if (isDuplicateKey(error)) {
      const names = await namesOf(deps.db, tenant);
      const existing = await closingRow(deps.db, tenant, eq(s.dailyClosings.businessDate, day));
      if (existing) return toDto(existing, names);
    }
    throw error;
  }
}

/** `GET /cash/closings`: the Z closings, newest first (RF-F03). */
export async function listClosings(deps: ServiceDeps, actor: Actor): Promise<ClosingDto[]> {
  assertPermission(actor, 'report.view');
  const tenant = tenantOf(actor);
  const names = await namesOf(deps.db, tenant);
  const rows = await deps.db
    .select()
    .from(s.dailyClosings)
    .where(
      and(
        eq(s.dailyClosings.locationId, tenant.locationId),
        eq(s.dailyClosings.organizationId, tenant.organizationId),
      ),
    )
    .orderBy(desc(s.dailyClosings.businessDate))
    .limit(400);
  return rows.map((row) => toDto(row, names));
}

/** `GET /cash/closings/{id}`: one Z, whether it is intact, and the money that came after it. */
export async function getClosing(
  deps: ServiceDeps,
  actor: Actor,
  id: string,
): Promise<ClosingDetail> {
  assertPermission(actor, 'report.view');
  const tenant = tenantOf(actor);
  const row = await closingRow(deps.db, tenant, eq(s.dailyClosings.id, id));
  if (!row) throw new ApiError('NOT_FOUND', 'Closing not found');
  const names = await namesOf(deps.db, tenant);
  const late = await dayInput(deps.db, tenant, row.businessDate, names, {
    createdAfter: row.createdAt,
  });
  const count =
    late.input.payments.length + late.input.refunds.length + late.input.movements.length;
  return {
    ...toDto(row, names),
    intact: (await contentHash(sealed(row))) === row.contentHash,
    corrections:
      count === 0 ? null : { count, totals: closingTotals({ ...late.input, reconciliations: [] }) },
  };
}

/** `GET /cash/book`: the daily cash book (Kassenbuch, RF-D16). */
export async function getCashBook(
  deps: ServiceDeps,
  actor: Actor,
  day: string,
): Promise<CashBook & { businessDate: string; shifts: { id: string; ownerName: string }[] }> {
  assertPermission(actor, 'report.view');
  const tenant = tenantOf(actor);
  const names = await namesOf(deps.db, tenant);
  const shifts = await deps.db
    .select()
    .from(s.shifts)
    .where(inLocation(s.shifts, tenant, eq(s.shifts.businessDate, day), notDeleted(s.shifts)));
  const entries: CashBookEntry[] = [];
  for (const shift of shifts) {
    entries.push({
      at: shift.openedAt.toISOString(),
      kind: 'opening',
      shiftId: shift.id,
      reference: null,
      amountRappen: shift.openingFloatRappen,
    });
    if (shift.status === 'closed' && shift.closedAt && shift.differenceRappen) {
      entries.push({
        at: shift.closedAt.toISOString(),
        kind: 'difference',
        shiftId: shift.id,
        reference: shift.differenceComment,
        amountRappen: shift.differenceRappen,
      });
    }
  }
  const sales = await deps.db
    .select({
      at: s.payments.completedAt,
      shiftId: s.payments.shiftId,
      amountRappen: s.payments.amountRappen,
      tipRappen: s.payments.tipRappen,
      roundingRappen: s.payments.roundingRappen,
      receiptNumber: s.receipts.receiptNumber,
    })
    .from(s.payments)
    .leftJoin(
      s.receipts,
      and(eq(s.receipts.paymentId, s.payments.id), eq(s.receipts.copyNumber, 0)),
    )
    .where(
      inLocation(
        s.payments,
        tenant,
        eq(s.payments.businessDate, day),
        eq(s.payments.method, 'cash'),
        notDeleted(s.payments),
      ),
    );
  for (const sale of sales) {
    entries.push({
      at: (sale.at ?? new Date(0)).toISOString(),
      kind: 'sale',
      shiftId: sale.shiftId,
      reference: sale.receiptNumber,
      amountRappen: sale.amountRappen + sale.tipRappen + sale.roundingRappen,
    });
  }
  const refunds = await deps.db
    .select({
      at: s.refunds.refundedAt,
      shiftId: s.refunds.shiftId,
      amountRappen: s.refunds.amountRappen,
      tipRappen: s.refunds.tipRappen,
      roundingRappen: s.refunds.roundingRappen,
      receiptNumber: s.receipts.receiptNumber,
    })
    .from(s.refunds)
    .leftJoin(
      s.receipts,
      and(eq(s.receipts.paymentId, s.refunds.paymentId), eq(s.receipts.copyNumber, 0)),
    )
    .where(
      inLocation(
        s.refunds,
        tenant,
        eq(s.refunds.businessDate, day),
        eq(s.refunds.method, 'cash'),
        notDeleted(s.refunds),
      ),
    );
  for (const refund of refunds) {
    entries.push({
      at: refund.at.toISOString(),
      kind: 'refund',
      shiftId: refund.shiftId,
      reference: refund.receiptNumber,
      amountRappen: -(refund.amountRappen + refund.tipRappen + refund.roundingRappen),
    });
  }
  const movements = await deps.db
    .select()
    .from(s.cashMovements)
    .where(
      inLocation(
        s.cashMovements,
        tenant,
        eq(s.cashMovements.businessDate, day),
        notDeleted(s.cashMovements),
      ),
    );
  for (const movement of movements) {
    entries.push({
      at: movement.occurredAt.toISOString(),
      kind: movement.kind as CashMovementKind,
      shiftId: movement.shiftId,
      reference: movement.reason,
      amountRappen: movement.amountRappen,
    });
  }
  return {
    businessDate: day,
    shifts: shifts.map((shift) => ({ id: shift.id, ownerName: ownerName(names, shift) })),
    ...cashBook(entries),
  };
}
