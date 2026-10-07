import { inLocation, notDeleted, schema as s } from '@pos/db';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { type Actor, requireLocationId } from '../actor';
import { notFound } from '../errors';
import { iso, type ServiceDeps } from './shared';

/**
 * Read side of the orders (RF-F14): the projection the cloud keeps from the operation log
 * (docs/SYNC.md). Orders are only ever written through `POST /sync/push`.
 */

type OrderRow = typeof s.orders.$inferSelect;

const toOrderSummary = (row: OrderRow) => ({
  id: row.id,
  businessDate: row.businessDate,
  displayNumber: row.displayNumber,
  channel: row.channel,
  consumptionType: row.consumptionType,
  tableId: row.tableId,
  joinedTableIds: row.joinedTableIds ?? [],
  waiterUserId: row.waiterUserId,
  guestCount: row.guestCount,
  status: row.status,
  paymentStatus: row.paymentStatus,
  customerName: row.customerName,
  subtotalRappen: row.subtotalRappen,
  discountTotalRappen: row.discountTotalRappen,
  totalRappen: row.totalRappen,
  taxTotalRappen: row.taxTotalRappen,
  paidRappen: row.paidTotalRappen,
  tipTotalRappen: row.tipTotalRappen,
  openedAt: iso(row.openedAt)!,
  closedAt: iso(row.closedAt),
  voidedAt: iso(row.voidedAt),
  mergedIntoOrderId: row.mergedIntoOrderId,
  splitFromOrderId: row.splitFromOrderId,
  terminalId: row.terminalId,
  version: row.version,
});
export type OrderSummaryDto = ReturnType<typeof toOrderSummary>;

export async function listOrders(
  deps: ServiceDeps,
  actor: Actor,
  query: { businessDate?: string; status?: string },
): Promise<OrderSummaryDto[]> {
  requireLocationId(actor);
  const rows = await deps.db
    .select()
    .from(s.orders)
    .where(
      inLocation(
        s.orders,
        actor,
        notDeleted(s.orders),
        query.businessDate ? eq(s.orders.businessDate, query.businessDate) : undefined,
        query.status ? eq(s.orders.status, query.status) : undefined,
      ),
    )
    .orderBy(desc(s.orders.openedAt))
    .limit(1000);
  return rows.map(toOrderSummary);
}

export async function getOrder(deps: ServiceDeps, actor: Actor, id: string) {
  requireLocationId(actor);
  const { db } = deps;
  const [row] = await db
    .select()
    .from(s.orders)
    .where(inLocation(s.orders, actor, eq(s.orders.id, id), notDeleted(s.orders)));
  if (!row) throw notFound('Order');
  const [items, discounts, payments, refunds, receipts] = await Promise.all([
    db
      .select()
      .from(s.orderItems)
      .where(inLocation(s.orderItems, actor, eq(s.orderItems.orderId, id)))
      .orderBy(asc(s.orderItems.createdAt)),
    db
      .select()
      .from(s.discounts)
      .where(inLocation(s.discounts, actor, eq(s.discounts.orderId, id))),
    db
      .select()
      .from(s.payments)
      .where(inLocation(s.payments, actor, eq(s.payments.orderId, id)))
      .orderBy(asc(s.payments.completedAt)),
    db
      .select()
      .from(s.refunds)
      .where(inLocation(s.refunds, actor, eq(s.refunds.orderId, id))),
    db
      .select()
      .from(s.receipts)
      .where(and(eq(s.receipts.locationId, actor.locationId!), eq(s.receipts.orderId, id)))
      .orderBy(asc(s.receipts.issuedAt)),
  ]);
  const modifiers =
    items.length === 0
      ? []
      : await db
          .select()
          .from(s.orderItemModifiers)
          .where(
            inLocation(
              s.orderItemModifiers,
              actor,
              inArray(
                s.orderItemModifiers.orderItemId,
                items.map((i) => i.id),
              ),
            ),
          );
  return {
    ...toOrderSummary(row),
    note: row.note,
    items: items.map((i) => ({
      id: i.id,
      productId: i.productId,
      variantId: i.variantId,
      name: i.nameSnapshot,
      variantName: i.variantNameSnapshot,
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
      sentAt: iso(i.sentAt),
      servedAt: iso(i.servedAt),
      voidedAt: iso(i.voidedAt),
      voidReason: i.voidReason,
      modifiers: modifiers
        .filter((m) => m.orderItemId === i.id)
        .map((m) => ({
          id: m.id,
          modifierId: m.modifierId,
          name: m.nameSnapshot,
          priceDeltaRappen: m.priceDeltaRappen,
          quantity: m.quantity,
        })),
    })),
    discounts: discounts.map((d) => ({
      id: d.id,
      itemId: d.orderItemId,
      kind: d.kind,
      value: d.value,
      amountRappen: d.amountRappen,
      reasonCode: d.reasonCode,
      removed: d.deletedAt !== null,
    })),
    payments: payments.map((p) => ({
      id: p.id,
      method: p.method,
      adapter: p.adapter,
      amountRappen: p.amountRappen,
      tipRappen: p.tipRappen,
      roundingRappen: p.roundingRappen,
      tenderedRappen: p.tenderedRappen,
      changeRappen: p.changeRappen,
      splitLabel: p.splitLabel,
      completedAt: iso(p.completedAt),
    })),
    refunds: refunds.map((r) => ({
      id: r.id,
      paymentId: r.paymentId,
      amountRappen: r.amountRappen,
      tipRappen: r.tipRappen,
      reason: r.reason,
      refundedAt: iso(r.refundedAt)!,
    })),
    receipts: receipts.map(toReceiptDto),
  };
}
export type OrderDto = Awaited<ReturnType<typeof getOrder>>;

const toReceiptDto = (r: typeof s.receipts.$inferSelect) => ({
  id: r.id,
  orderId: r.orderId,
  paymentId: r.paymentId,
  receiptNumber: r.receiptNumber,
  copyNumber: r.copyNumber,
  language: r.language,
  content: r.content,
  contentHash: r.contentHash,
  customerName: r.customerName,
  issuedAt: iso(r.issuedAt)!,
});

export async function getReceipt(deps: ServiceDeps, actor: Actor, id: string) {
  const locationId = requireLocationId(actor);
  const [row] = await deps.db
    .select()
    .from(s.receipts)
    .where(
      and(
        eq(s.receipts.organizationId, actor.organizationId),
        eq(s.receipts.locationId, locationId),
        eq(s.receipts.id, id),
      ),
    );
  if (!row) throw notFound('Receipt');
  return toReceiptDto(row);
}
