import type { FoldState, OrderState, ReceiptState } from '@pos/core';
import { schema as s, type Transaction } from '@pos/db';
import { and, eq, getTableColumns, inArray, max, not, sql, type SQL } from 'drizzle-orm';
import type { MySqlTable } from 'drizzle-orm/mysql-core';
import type { SyncScope } from './store';

/**
 * Writes the fold of a group of orders into the projection tables (docs/SYNC.md §6.1). Rows are
 * upserted by the device ids, so writing the same fold twice changes nothing. Receipts are
 * append-only: they are only ever inserted. A unique key that collides (an order or receipt
 * number repeated by a wiped device) never throws: the row is stored with a suffix and the
 * caller records a `duplicate_number` conflict.
 */

const CHUNK = 200;
const NEVER_UPDATED = new Set(['id', 'organizationId', 'locationId', 'createdAt']);

const at = (iso: string | null): Date | null => (iso === null ? null : new Date(iso));

async function upsert<T extends MySqlTable>(
  tx: Transaction,
  table: T,
  rows: T['$inferInsert'][],
  keep: readonly string[] = [],
): Promise<void> {
  if (rows.length === 0) return;
  const set: Record<string, SQL> = {};
  for (const [key, column] of Object.entries(getTableColumns(table))) {
    if (NEVER_UPDATED.has(key) || keep.includes(key)) continue;
    set[key] = sql.raw(`values(\`${column.name}\`)`);
  }
  for (let start = 0; start < rows.length; start += CHUNK) {
    await tx
      .insert(table)
      .values(rows.slice(start, start + CHUNK))
      .onDuplicateKeyUpdate({ set: set as never });
  }
}

export interface ProjectionResult {
  /** Stored state of the group's orders before this write (for the events diff). */
  previous: Map<string, { status: string; displayNumber: string }>;
  /** Orders stored with another number because theirs was taken (order id → stored number). */
  renumbered: Map<string, string>;
  /** Receipts inserted now (new originals and copies). */
  insertedReceipts: ReceiptState[];
}

/** A free variant of a taken number: `0042` → `0042/2`, `0042/3`… */
async function freeNumber(
  number: string,
  taken: (candidate: string) => Promise<boolean>,
): Promise<string> {
  for (let n = 2; n < 100; n += 1) {
    const candidate = `${number}/${n}`;
    if (!(await taken(candidate))) return candidate;
  }
  throw new Error(`No free variant for number ${number}`);
}

export async function writeProjection(
  tx: Transaction,
  scope: SyncScope,
  state: FoldState,
  orderIds: ReadonlySet<string>,
): Promise<ProjectionResult> {
  const now = new Date();
  const orders = [...state.orders.values()].filter((o) => orderIds.has(o.id));
  const ids = orders.map((o) => o.id);

  const previousRows =
    ids.length === 0
      ? []
      : await tx
          .select({
            id: s.orders.id,
            status: s.orders.status,
            displayNumber: s.orders.displayNumber,
          })
          .from(s.orders)
          .where(and(eq(s.orders.locationId, scope.locationId), inArray(s.orders.id, ids)));
  const previous = new Map(previousRows.map((r) => [r.id, r]));

  // New orders whose number is already used by another order of the day (RN-16 never reuses).
  // This must hold inside the batch too: `ON DUPLICATE KEY UPDATE` also fires on the unique
  // number index, and would silently overwrite one order with another. Orders come in fold
  // (canonical) order, so the first one keeps its number.
  const renumbered = new Map<string, string>();
  const usedInBatch = new Set(
    orders
      .filter((o) => previous.has(o.id))
      .map((o) => `${o.businessDate}:${previous.get(o.id)!.displayNumber}`),
  );
  for (const order of orders) {
    if (previous.has(order.id)) continue;
    const taken = async (display: string) => {
      if (usedInBatch.has(`${order.businessDate}:${display}`)) return true;
      const [row] = await tx
        .select({ id: s.orders.id })
        .from(s.orders)
        .where(
          and(
            eq(s.orders.locationId, scope.locationId),
            eq(s.orders.businessDate, order.businessDate),
            eq(s.orders.displayNumber, display),
            not(eq(s.orders.id, order.id)),
          ),
        )
        .limit(1);
      return Boolean(row);
    };
    const display = (await taken(order.displayNumber))
      ? await freeNumber(order.displayNumber, taken)
      : order.displayNumber;
    if (display !== order.displayNumber) renumbered.set(order.id, display);
    usedInBatch.add(`${order.businessDate}:${display}`);
  }

  await upsert(
    tx,
    s.orders,
    orders.map((o) => orderRow(scope, o, renumbered.get(o.id) ?? o.displayNumber, now)),
    // The number stays as first stored (a renumbered order keeps its suffix).
    ['displayNumber', 'orderNumber', 'orderNumberPrefix', 'businessDate'],
  );

  // Offline numbers: remember the highest one per prefix (docs/SYNC.md §8).
  const prefixed = new Map<string, { businessDate: string; prefix: string; number: number }>();
  for (const o of orders) {
    if (o.orderNumberPrefix === '') continue;
    const key = `${o.businessDate}:${o.orderNumberPrefix}`;
    const current = prefixed.get(key);
    if (!current || o.orderNumber > current.number) {
      prefixed.set(key, {
        businessDate: o.businessDate,
        prefix: o.orderNumberPrefix,
        number: o.orderNumber,
      });
    }
  }
  for (const seqRow of prefixed.values()) {
    await tx
      .insert(s.orderNumberSequences)
      .values({
        organizationId: scope.organizationId,
        locationId: scope.locationId,
        businessDate: seqRow.businessDate,
        prefix: seqRow.prefix,
        lastNumber: seqRow.number,
        updatedAt: now,
      })
      .onDuplicateKeyUpdate({
        set: {
          lastNumber: sql`greatest(${s.orderNumberSequences.lastNumber}, ${seqRow.number})`,
          updatedAt: now,
        },
      });
  }

  const items = [...state.items.values()].filter((i) => orderIds.has(i.orderId));
  await upsert(
    tx,
    s.orderItems,
    items.map((i) => ({
      id: i.id,
      organizationId: scope.organizationId,
      locationId: scope.locationId,
      orderId: i.orderId,
      productId: i.productId,
      variantId: i.variantId,
      nameSnapshot: i.name,
      variantNameSnapshot: i.variantName,
      quantity: i.quantity,
      unitPriceRappen: i.unitPriceRappen,
      modifiersRappen: i.modifiersRappen,
      discountRappen: i.discountRappen,
      lineTotalRappen: i.lineTotalRappen,
      taxCategoryKey: i.taxCategoryKey,
      taxRateCode: i.taxRateCode,
      taxRateBp: i.taxRateBp,
      taxRappen: i.taxRappen,
      course: i.course,
      seat: i.seat,
      note: i.note,
      prepStatus: i.prepStatus,
      sentAt: at(i.sentAt),
      servedAt: at(i.servedAt),
      voidedAt: at(i.voidedAt),
      voidReason: i.voidReason,
      voidedByUserId: i.voidedByUserId,
      voidAuthorizedByUserId: i.voidAuthorizedByUserId,
      addedByUserId: i.addedByUserId,
      transferredFromOrderId: i.transferredFromOrderId,
      deviceUpdatedAt: at(i.voidedAt ?? i.servedAt ?? i.sentAt ?? i.addedAt),
      updatedAt: now,
    })),
  );
  await upsert(
    tx,
    s.orderItemModifiers,
    items.flatMap((i) =>
      i.modifiers.map((m) => ({
        id: m.id,
        organizationId: scope.organizationId,
        locationId: scope.locationId,
        orderItemId: i.id,
        modifierId: m.modifierId,
        nameSnapshot: m.name,
        priceDeltaRappen: m.priceDeltaRappen,
        quantity: m.quantity,
        updatedAt: now,
      })),
    ),
  );

  await upsert(
    tx,
    s.discounts,
    [...state.discounts.values()]
      .filter((d) => orderIds.has(d.orderId))
      .map((d) => ({
        id: d.id,
        organizationId: scope.organizationId,
        locationId: scope.locationId,
        orderId: d.orderId,
        orderItemId: d.itemId,
        kind: d.kind,
        value: d.value,
        amountRappen: d.amountRappen,
        reasonCode: d.reasonCode,
        reasonText: d.reasonText,
        appliedByUserId: d.appliedByUserId,
        authorizedByUserId: d.authorizedByUserId,
        deviceUpdatedAt: at(d.removedAt ?? d.appliedAt),
        // A removed discount is soft-deleted, never deleted (RN-11).
        deletedAt: at(d.removedAt),
        updatedAt: now,
      })),
  );

  const payments = [...state.payments.values()].filter((p) => orderIds.has(p.orderId));
  await upsert(
    tx,
    s.payments,
    payments.map((p) => ({
      id: p.id,
      organizationId: scope.organizationId,
      locationId: scope.locationId,
      orderId: p.orderId,
      terminalId: p.terminalId,
      userId: p.userId,
      method: p.method,
      adapter: p.adapter,
      status: 'completed',
      amountRappen: p.amountRappen,
      roundingRappen: p.roundingRappen,
      tipRappen: p.tipRappen,
      tenderedRappen: p.tenderedRappen ?? 0,
      changeRappen: p.changeRappen,
      externalReference: p.externalReference,
      splitLabel: p.splitLabel,
      idempotencyKey: p.id,
      completedAt: at(p.completedAt),
      deviceUpdatedAt: at(p.completedAt),
      updatedAt: now,
    })),
  );
  // Tips go to the waiter fixed at payment time (RN-07, RF-D06).
  await upsert(
    tx,
    s.tips,
    payments
      .filter((p) => p.tipRappen > 0)
      .map((p) => ({
        id: p.id,
        organizationId: scope.organizationId,
        locationId: scope.locationId,
        paymentId: p.id,
        orderId: p.orderId,
        userId: p.tipUserId ?? p.userId,
        amountRappen: p.tipRappen,
        deviceUpdatedAt: at(p.completedAt),
        updatedAt: now,
      })),
  );
  await upsert(
    tx,
    s.refunds,
    [...state.refunds.values()]
      .filter((r) => orderIds.has(r.orderId))
      .map((r) => ({
        id: r.id,
        organizationId: scope.organizationId,
        locationId: scope.locationId,
        paymentId: r.paymentId,
        orderId: r.orderId,
        method: r.method,
        adapter: r.adapter,
        amountRappen: r.amountRappen,
        tipRappen: r.tipRappen,
        reason: r.reason,
        userId: r.userId,
        authorizedByUserId: r.authorizedByUserId,
        externalReference: r.externalReference,
        idempotencyKey: r.id,
        refundedAt: new Date(r.refundedAt),
        deviceUpdatedAt: at(r.refundedAt),
        updatedAt: now,
      })),
  );

  const insertedReceipts = await insertReceipts(
    tx,
    scope,
    [...state.receipts.values()].filter((r) => orderIds.has(r.orderId)),
    now,
  );
  return { previous, renumbered, insertedReceipts };
}

function orderRow(scope: SyncScope, o: OrderState, displayNumber: string, now: Date) {
  return {
    id: o.id,
    organizationId: scope.organizationId,
    locationId: scope.locationId,
    terminalId: o.terminalId,
    businessDate: o.businessDate,
    orderNumber: o.orderNumber,
    orderNumberPrefix: o.orderNumberPrefix,
    displayNumber,
    channel: o.channel,
    consumptionType: o.consumptionType,
    tableId: o.tableId,
    joinedTableIds: o.joinedTableIds,
    waiterUserId: o.waiterUserId,
    guestCount: o.guestCount,
    status: o.status,
    paymentStatus: o.paymentStatus,
    customerName: o.customerName,
    note: o.note,
    subtotalRappen: o.subtotalRappen,
    discountTotalRappen: o.discountTotalRappen,
    totalRappen: o.totalRappen,
    taxTotalRappen: o.taxTotalRappen,
    paidTotalRappen: o.paidRappen,
    tipTotalRappen: o.tipTotalRappen,
    openedAt: new Date(o.openedAt),
    closedAt: at(o.closedAt),
    voidedAt: at(o.voidedAt),
    voidReason: o.voidReason,
    reopenedAt: at(o.reopenedAt),
    mergedIntoOrderId: o.mergedIntoOrderId,
    splitFromOrderId: o.splitFromOrderId,
    createdByUserId: o.createdByUserId,
    version: o.version,
    deviceUpdatedAt: new Date(o.updatedAt),
    updatedAt: now,
  };
}

/**
 * Inserts the receipts not stored yet (RN-09, RN-10). Copies get the next copy number of their
 * original; an original whose number is taken by another receipt is stored with a suffix.
 */
async function insertReceipts(
  tx: Transaction,
  scope: SyncScope,
  receipts: readonly ReceiptState[],
  now: Date,
): Promise<ReceiptState[]> {
  if (receipts.length === 0) return [];
  const stored = await tx
    .select({ id: s.receipts.id, receiptNumber: s.receipts.receiptNumber })
    .from(s.receipts)
    .where(
      and(
        eq(s.receipts.locationId, scope.locationId),
        inArray(
          s.receipts.id,
          receipts.map((r) => r.id),
        ),
      ),
    );
  const storedNumber = new Map(stored.map((r) => [r.id, r.receiptNumber]));
  const inserted: ReceiptState[] = [];
  // Originals first, so a copy finds the number its original was stored with.
  const ordered = [...receipts].sort(
    (a, b) =>
      Number(a.copyOfReceiptId !== null) - Number(b.copyOfReceiptId !== null) ||
      (a.issuedAt < b.issuedAt ? -1 : a.issuedAt > b.issuedAt ? 1 : a.id < b.id ? -1 : 1),
  );
  for (const receipt of ordered) {
    if (storedNumber.has(receipt.id)) continue;
    let receiptNumber = receipt.receiptNumber;
    let copyNumber = 0;
    if (receipt.copyOfReceiptId) {
      receiptNumber = storedNumber.get(receipt.copyOfReceiptId) ?? receipt.receiptNumber;
      const [row] = await tx
        .select({ value: max(s.receipts.copyNumber) })
        .from(s.receipts)
        .where(
          and(
            eq(s.receipts.locationId, scope.locationId),
            eq(s.receipts.receiptNumber, receiptNumber),
          ),
        );
      copyNumber = Number(row?.value ?? 0) + 1;
    } else {
      const taken = async (candidate: string) => {
        const [row] = await tx
          .select({ id: s.receipts.id })
          .from(s.receipts)
          .where(
            and(
              eq(s.receipts.locationId, scope.locationId),
              eq(s.receipts.receiptNumber, candidate),
              eq(s.receipts.copyNumber, 0),
            ),
          )
          .limit(1);
        return Boolean(row);
      };
      if (await taken(receiptNumber)) receiptNumber = await freeNumber(receiptNumber, taken);
    }
    await tx.insert(s.receipts).values({
      id: receipt.id,
      organizationId: scope.organizationId,
      locationId: scope.locationId,
      orderId: receipt.orderId,
      paymentId: receipt.paymentId,
      receiptNumber,
      copyNumber,
      language: receipt.language,
      content: receipt.content as unknown as Record<string, unknown>,
      contentHash: receipt.contentHash,
      customerName: receipt.customerName,
      customerAddress: receipt.customerAddress,
      terminalId: receipt.terminalId,
      issuedByUserId: receipt.issuedByUserId,
      issuedAt: new Date(receipt.issuedAt),
      createdAt: now,
    });
    storedNumber.set(receipt.id, receiptNumber);
    inserted.push({ ...receipt, receiptNumber });
  }
  return inserted;
}
