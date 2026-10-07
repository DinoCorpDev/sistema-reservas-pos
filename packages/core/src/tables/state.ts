import { type FoldState, itemsOf, type OrderState } from '../orders/state';
import type { TableState } from './constants';

/**
 * Table state on the map (RF-C01). It is DERIVED from the open orders; nobody sets it by hand.
 * "reserved" comes with the reservations (Phase 5) and "ready" with the KDS (Phase 3).
 */

/** State of one open order, as the table shows it. */
export function orderTableState(state: FoldState, order: OrderState): TableState {
  const valid = itemsOf(state, order.id).filter((item) => item.prepStatus !== 'voided');
  if (valid.some((item) => item.prepStatus === 'ready')) return 'ready';
  if (valid.every((item) => item.prepStatus === 'pending')) return 'awaiting_order';
  if (valid.some((item) => item.prepStatus === 'sent' || item.prepStatus === 'preparing')) {
    return 'in_kitchen';
  }
  if (valid.every((item) => item.prepStatus === 'served')) {
    return order.balanceRappen > 0 ? 'awaiting_payment' : 'occupied';
  }
  // Some courses served, the next one not sent yet.
  return 'occupied';
}

/** What needs attention first wins when a table has several orders (RF-C05) or is joined. */
const PRIORITY: readonly TableState[] = [
  'ready',
  'awaiting_payment',
  'awaiting_order',
  'in_kitchen',
  'occupied',
  'reserved',
  'free',
];

export interface TableView {
  state: TableState;
  orderIds: string[];
  /** Earliest opening and latest kitchen send of its orders (RF-C19). */
  openedAt: string | null;
  lastSentAt: string | null;
  /** Table this one is joined to (RF-C03), if any. */
  joinedToTableId: string | null;
}

export function tableViews(state: FoldState): Map<string, TableView> {
  const views = new Map<string, TableView>();
  for (const order of state.orders.values()) {
    if (order.status !== 'open' || order.tableId === null) continue;
    const orderState = orderTableState(state, order);
    const tables = [order.tableId, ...order.joinedTableIds.filter((id) => id !== order.tableId)];
    for (const tableId of tables) {
      const view = views.get(tableId) ?? {
        state: 'free' as TableState,
        orderIds: [],
        openedAt: null,
        lastSentAt: null,
        joinedToTableId: null,
      };
      if (PRIORITY.indexOf(orderState) < PRIORITY.indexOf(view.state)) view.state = orderState;
      view.orderIds.push(order.id);
      if (view.openedAt === null || order.openedAt < view.openedAt) view.openedAt = order.openedAt;
      if (order.lastSentAt && (view.lastSentAt === null || order.lastSentAt > view.lastSentAt)) {
        view.lastSentAt = order.lastSentAt;
      }
      if (tableId !== order.tableId) view.joinedToTableId = order.tableId;
      views.set(tableId, view);
    }
  }
  return views;
}

export function tableStateOf(views: Map<string, TableView>, tableId: string): TableState {
  return views.get(tableId)?.state ?? 'free';
}
