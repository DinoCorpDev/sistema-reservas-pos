import {
  type AccountingRow,
  accountingRows,
  addDays,
  type AdjustmentsReport,
  adjustmentsReport,
  businessDate as businessDateOf,
  changePerMille,
  type ItemSalesReport,
  itemSalesReport,
  type KitchenTimesReport,
  kitchenTimesReport,
  previousPeriod,
  type ReportPeriod,
  type SalesReport,
  salesReport,
  tableTimesReport,
  type TipLine,
  tipsReport,
  type VatGranularity,
  type VatReport,
  vatReport,
} from '@pos/core';
import { inLocation, notDeleted, schema as s } from '@pos/db';
import { and, between, desc, eq, isNotNull, ne, sql } from 'drizzle-orm';
import type { Actor } from '../../actor';
import type { ServiceDeps } from '../shared';
import { reportContext, userNames } from './context';
import { loadMoney, salesOf } from './money-input';

/**
 * Reports of the backoffice and the API (RF-F01…RF-F10). Money follows the rule of the Z, so a
 * period of whole days adds up to its closings (DEC-038); each report reads only its period.
 * Every report needs `report.view` and stays inside the actor's location.
 */

export interface SalesReportDto {
  period: ReportPeriod;
  sales: SalesReport;
  previous: ReportPeriod & { salesRappen: number; changePerMille: number | null };
  items: ItemSalesReport;
  /** Sales of the Zs − positions of the closed orders: refunds, partial payments, other days. */
  itemsDifferenceRappen: number;
  userNames: Record<string, string>;
}

/** `GET /reports/sales` (RF-F01). */
export async function getSalesReport(
  deps: ServiceDeps,
  actor: Actor,
  period: ReportPeriod,
): Promise<SalesReportDto> {
  const context = await reportContext(deps, actor);
  const before = previousPeriod(period);
  const [money, previousSales, lines, names] = await Promise.all([
    loadMoney(context, period),
    salesOf(context, before),
    context.db
      .select({
        productId: s.orderItems.productId,
        productName: s.orderItems.nameSnapshot,
        categoryId: s.categories.id,
        categoryName: s.categories.name,
        quantity: s.orderItems.quantity,
        lineTotalRappen: s.orderItems.lineTotalRappen,
      })
      .from(s.orderItems)
      .innerJoin(s.orders, eq(s.orders.id, s.orderItems.orderId))
      .leftJoin(s.products, eq(s.products.id, s.orderItems.productId))
      .leftJoin(s.categories, eq(s.categories.id, s.products.categoryId))
      .where(
        inLocation(
          s.orders,
          context.tenant,
          between(s.orders.businessDate, period.from, period.to),
          // Closed = served or voided and paid in full (RN-12); a later refund keeps it closed.
          eq(s.orders.status, 'closed'),
          ne(s.orderItems.prepStatus, 'voided'),
          notDeleted(s.orders),
          notDeleted(s.orderItems),
        ),
      ),
    userNames(context.db, context.tenant),
  ]);
  const sales = salesReport(money);
  const items = itemSalesReport(lines);
  return {
    period,
    sales,
    previous: {
      ...before,
      salesRappen: previousSales,
      changePerMille: changePerMille(sales.salesRappen, previousSales),
    },
    items,
    itemsDifferenceRappen: sales.salesRappen - items.salesRappen,
    userNames: names,
  };
}

/** `GET /reports/vat` (RF-F02): MWST by rate and period for the return. */
export async function getVatReport(
  deps: ServiceDeps,
  actor: Actor,
  query: ReportPeriod & { granularity: VatGranularity },
): Promise<VatReport & { period: ReportPeriod; granularity: VatGranularity }> {
  const context = await reportContext(deps, actor);
  const period = { from: query.from, to: query.to };
  const money = await loadMoney(context, period);
  return { ...vatReport(money, query.granularity), period, granularity: query.granularity };
}

/** `GET /reports/accounting` (RF-F04): day × payment method × MWST rate. */
export async function getAccountingRows(
  deps: ServiceDeps,
  actor: Actor,
  period: ReportPeriod,
): Promise<{ period: ReportPeriod; rows: AccountingRow[] }> {
  const context = await reportContext(deps, actor);
  return { period, rows: accountingRows(await loadMoney(context, period)) };
}

/** `GET /reports/tips` (RF-F07). */
export async function getTipsReport(
  deps: ServiceDeps,
  actor: Actor,
  period: ReportPeriod,
): Promise<{
  period: ReportPeriod;
  tipsRappen: number;
  byPerson: (TipLine & { name: string | null })[];
}> {
  const context = await reportContext(deps, actor);
  const [money, names] = await Promise.all([
    loadMoney(context, period),
    userNames(context.db, context.tenant),
  ]);
  const report = tipsReport(money);
  return {
    period,
    tipsRappen: report.tipsRappen,
    byPerson: report.byPerson.map((line) => ({
      ...line,
      name: line.userId ? (names[line.userId] ?? null) : null,
    })),
  };
}

/** `GET /reports/adjustments` (RF-F06): voids, discounts and refunds by person. */
export async function getAdjustmentsReport(
  deps: ServiceDeps,
  actor: Actor,
  period: ReportPeriod,
): Promise<AdjustmentsReport & { period: ReportPeriod; userNames: Record<string, string> }> {
  const context = await reportContext(deps, actor);
  const { db, tenant } = context;
  const inPeriod = between(s.orders.businessDate, period.from, period.to);
  const [voids, discounts, refunds, names] = await Promise.all([
    db
      .select({
        voidedAt: s.orderItems.voidedAt,
        updatedAt: s.orderItems.updatedAt,
        userId: s.orderItems.voidedByUserId,
        authorizedByUserId: s.orderItems.voidAuthorizedByUserId,
        reason: s.orderItems.voidReason,
        productName: s.orderItems.nameSnapshot,
        quantity: s.orderItems.quantity,
        lineTotalRappen: s.orderItems.lineTotalRappen,
        discountRappen: s.orderItems.discountRappen,
        orderNumber: s.orders.displayNumber,
      })
      .from(s.orderItems)
      .innerJoin(s.orders, eq(s.orders.id, s.orderItems.orderId))
      .where(inLocation(s.orders, tenant, inPeriod, eq(s.orderItems.prepStatus, 'voided'))),
    db
      .select({
        createdAt: s.discounts.createdAt,
        userId: s.discounts.appliedByUserId,
        authorizedByUserId: s.discounts.authorizedByUserId,
        reasonCode: s.discounts.reasonCode,
        reasonText: s.discounts.reasonText,
        amountRappen: s.discounts.amountRappen,
        orderNumber: s.orders.displayNumber,
      })
      .from(s.discounts)
      .innerJoin(s.orders, eq(s.orders.id, s.discounts.orderId))
      .where(
        inLocation(
          s.orders,
          tenant,
          inPeriod,
          ne(s.orders.status, 'voided'),
          notDeleted(s.discounts),
        ),
      ),
    db
      .select({
        refundedAt: s.refunds.refundedAt,
        userId: s.refunds.userId,
        authorizedByUserId: s.refunds.authorizedByUserId,
        reason: s.refunds.reason,
        amountRappen: s.refunds.amountRappen,
        orderNumber: s.orders.displayNumber,
      })
      .from(s.refunds)
      .innerJoin(s.orders, eq(s.orders.id, s.refunds.orderId))
      .where(
        inLocation(
          s.refunds,
          tenant,
          between(s.refunds.businessDate, period.from, period.to),
          notDeleted(s.refunds),
        ),
      ),
    userNames(db, tenant),
  ]);
  return {
    ...adjustmentsReport({
      voids: voids.map((v) => ({
        at: (v.voidedAt ?? v.updatedAt).toISOString(),
        userId: v.userId,
        authorizedByUserId: v.authorizedByUserId,
        reason: v.reason,
        productName: v.productName,
        quantity: v.quantity,
        grossRappen: v.lineTotalRappen + v.discountRappen,
        orderNumber: v.orderNumber,
      })),
      discounts: discounts.map((d) => ({
        at: d.createdAt.toISOString(),
        userId: d.userId,
        authorizedByUserId: d.authorizedByUserId,
        reason: d.reasonText?.trim() ? d.reasonText : d.reasonCode,
        amountRappen: d.amountRappen,
        orderNumber: d.orderNumber,
      })),
      refunds: refunds.map((r) => ({
        at: r.refundedAt.toISOString(),
        userId: r.userId,
        authorizedByUserId: r.authorizedByUserId,
        reason: r.reason,
        amountRappen: r.amountRappen,
        orderNumber: r.orderNumber,
      })),
    }),
    period,
    userNames: names,
  };
}

/** `GET /reports/times` (RF-F08): kitchen send → ready, and how long tables stay open. */
export async function getTimesReport(
  deps: ServiceDeps,
  actor: Actor,
  period: ReportPeriod,
): Promise<{
  period: ReportPeriod;
  kitchen: KitchenTimesReport;
  tables: ReturnType<typeof tableTimesReport>;
  stationNames: Record<string, string>;
  tableLabels: Record<string, string>;
}> {
  const context = await reportContext(deps, actor);
  const { db, tenant } = context;
  const inPeriod = between(s.orders.businessDate, period.from, period.to);
  const [kitchen, tables, stations, labels] = await Promise.all([
    db
      .select({
        stationId: s.kitchenTickets.kitchenStationId,
        productId: s.orderItems.productId,
        productName: s.orderItems.nameSnapshot,
        sentAt: s.kitchenTickets.sentAt,
        readyAt: s.kitchenTicketItems.readyAt,
      })
      .from(s.kitchenTicketItems)
      .innerJoin(s.kitchenTickets, eq(s.kitchenTickets.id, s.kitchenTicketItems.kitchenTicketId))
      .innerJoin(s.orderItems, eq(s.orderItems.id, s.kitchenTicketItems.orderItemId))
      .innerJoin(s.orders, eq(s.orders.id, s.kitchenTickets.orderId))
      .where(inLocation(s.orders, tenant, inPeriod, isNotNull(s.kitchenTicketItems.readyAt))),
    db
      .select({
        tableId: s.orders.tableId,
        openedAt: s.orders.openedAt,
        closedAt: s.orders.closedAt,
        guestCount: s.orders.guestCount,
      })
      .from(s.orders)
      .where(
        inLocation(
          s.orders,
          tenant,
          inPeriod,
          eq(s.orders.status, 'closed'),
          isNotNull(s.orders.tableId),
          isNotNull(s.orders.closedAt),
          notDeleted(s.orders),
        ),
      ),
    db
      .select({ id: s.kitchenStations.id, name: s.kitchenStations.name })
      .from(s.kitchenStations)
      .where(inLocation(s.kitchenStations, tenant)),
    db
      .select({ id: s.diningTables.id, label: s.diningTables.label })
      .from(s.diningTables)
      .where(inLocation(s.diningTables, tenant)),
  ]);
  return {
    period,
    kitchen: kitchenTimesReport(
      kitchen.flatMap((row) =>
        row.readyAt
          ? [
              {
                stationId: row.stationId,
                productId: row.productId,
                productName: row.productName,
                sentAt: row.sentAt.toISOString(),
                readyAt: row.readyAt.toISOString(),
              },
            ]
          : [],
      ),
    ),
    tables: tableTimesReport(
      tables.flatMap((row) =>
        row.tableId && row.closedAt
          ? [
              {
                tableId: row.tableId,
                openedAt: row.openedAt.toISOString(),
                closedAt: row.closedAt.toISOString(),
                guestCount: row.guestCount,
              },
            ]
          : [],
      ),
    ),
    stationNames: Object.fromEntries(stations.map((station) => [station.id, station.name])),
    tableLabels: Object.fromEntries(labels.map((table) => [table.id, table.label])),
  };
}

export interface DashboardDto {
  businessDate: string;
  refreshedAt: string;
  salesRappen: number;
  tipsRappen: number;
  paymentCount: number;
  byMethod: SalesReport['byMethod'];
  /** Same weekday a week earlier, for comparison. */
  lastWeekSalesRappen: number;
  openOrders: { count: number; totalRappen: number; balanceRappen: number; guests: number };
  tables: { occupied: number; total: number };
  openShifts: number;
  lastClosing: { businessDate: string; closingNumber: number } | null;
}

/**
 * `GET /reports/dashboard` (RF-F10): the owner's view of today, refreshed every 30 s by the
 * backoffice: sales so far, open orders and tables, open shifts and the last Z.
 */
export async function getDashboard(deps: ServiceDeps, actor: Actor): Promise<DashboardDto> {
  const context = await reportContext(deps, actor);
  const { db, tenant } = context;
  const now = new Date();
  const today = businessDateOf(now, context.timezone, context.settings.businessDayStartsAt);
  const lastWeek = addDays(today, -7);
  const [money, lastWeekSales, open, tableCount, shifts, closing] = await Promise.all([
    loadMoney(context, { from: today, to: today }),
    salesOf(context, { from: lastWeek, to: lastWeek }),
    db
      .select({
        tableId: s.orders.tableId,
        joinedTableIds: s.orders.joinedTableIds,
        totalRappen: s.orders.totalRappen,
        paidTotalRappen: s.orders.paidTotalRappen,
        guestCount: s.orders.guestCount,
      })
      .from(s.orders)
      .where(inLocation(s.orders, tenant, eq(s.orders.status, 'open'), notDeleted(s.orders))),
    db
      .select({ count: sql<number>`count(*)` })
      .from(s.diningTables)
      .where(
        inLocation(
          s.diningTables,
          tenant,
          eq(s.diningTables.isActive, true),
          notDeleted(s.diningTables),
        ),
      ),
    db
      .select({ count: sql<number>`count(*)` })
      .from(s.shifts)
      .where(inLocation(s.shifts, tenant, eq(s.shifts.status, 'open'), notDeleted(s.shifts))),
    db
      .select({
        businessDate: s.dailyClosings.businessDate,
        closingNumber: s.dailyClosings.closingNumber,
      })
      .from(s.dailyClosings)
      .where(
        and(
          eq(s.dailyClosings.organizationId, tenant.organizationId),
          eq(s.dailyClosings.locationId, tenant.locationId),
        ),
      )
      .orderBy(desc(s.dailyClosings.businessDate))
      .limit(1),
  ]);
  const sales = salesReport(money);
  const occupied = new Set<string>();
  for (const order of open) {
    if (order.tableId) occupied.add(order.tableId);
    for (const id of (order.joinedTableIds as string[] | null) ?? []) occupied.add(id);
  }
  return {
    businessDate: today,
    refreshedAt: now.toISOString(),
    salesRappen: sales.salesRappen,
    tipsRappen: sales.tipsRappen,
    paymentCount: sales.paymentCount,
    byMethod: sales.byMethod,
    lastWeekSalesRappen: lastWeekSales,
    openOrders: {
      count: open.length,
      totalRappen: open.reduce((total, o) => total + o.totalRappen, 0),
      balanceRappen: open.reduce(
        (total, o) => total + Math.max(0, o.totalRappen - o.paidTotalRappen),
        0,
      ),
      guests: open.reduce((total, o) => total + (o.guestCount ?? 0), 0),
    },
    tables: { occupied: occupied.size, total: Number(tableCount[0]?.count ?? 0) },
    openShifts: Number(shifts[0]?.count ?? 0),
    lastClosing: closing[0] ?? null,
  };
}
