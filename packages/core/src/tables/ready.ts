import type { FoldState, OrderState } from '../orders/state';
import { orderTableState } from './state';

/**
 * What a waiter has to hand over (DEC-034): the POS header counts, per place, the waiter's open
 * orders with something ready at the pass, so nothing waits forgotten after the kitchen's notice
 * is gone. "Ready" is the same as the green table on the map (`orderTableState`).
 */

/** Where an open order is handed over: at its table, at the bar, or to take away. */
export type ServiceGroup = 'tables' | 'bar' | 'takeaway';

export function serviceGroupOf(order: Pick<OrderState, 'channel' | 'tableId'>): ServiceGroup {
  if (order.tableId !== null) return 'tables';
  return order.channel === 'bar' ? 'bar' : 'takeaway';
}

/**
 * Open orders of `waiterUserId` with something ready, per group. Tables count once even with
 * several orders (RF-C05); the bar and take-away count orders.
 */
export function readyToServe(state: FoldState, waiterUserId: string): Record<ServiceGroup, number> {
  const tables = new Set<string>();
  let bar = 0;
  let takeaway = 0;
  for (const order of state.orders.values()) {
    if (order.status !== 'open' || order.waiterUserId !== waiterUserId) continue;
    if (orderTableState(state, order) !== 'ready') continue;
    const group = serviceGroupOf(order);
    if (group === 'tables') tables.add(order.tableId!);
    else if (group === 'bar') bar += 1;
    else takeaway += 1;
  }
  return { tables: tables.size, bar, takeaway };
}
