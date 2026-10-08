import type { KitchenTicketView } from '@pos/core';
import { dispatch } from '@/device/engine';
import { makeOperation } from '@/device/operations';
import { requestSync } from '@/device/sync';

/**
 * What the kitchen display can do (RF-C22, RF-C26, RF-C28, DEC-029). Every action is one
 * operation stored on the device and synchronized like the POS ones, so the kitchen keeps
 * working through the hub when the internet is down (RF-C27).
 */

async function record(...args: Parameters<typeof makeOperation>): Promise<void> {
  await dispatch(await makeOperation(...args));
  requestSync();
}

/** Items of the ticket the kitchen can still move (not served, not voided). */
const liveItems = (ticket: KitchenTicketView, status?: string) =>
  ticket.items
    .filter((item) => item.status !== 'served' && item.status !== 'voided')
    .filter((item) => status === undefined || item.status === status)
    .map((item) => item.itemId);

async function move(
  type: 'kitchen.start' | 'kitchen.ready' | 'kitchen.recall',
  ticket: KitchenTicketView,
  itemIds: string[],
): Promise<void> {
  if (itemIds.length === 0) return;
  await record(type, ticket.orderId, { stationId: ticket.stationId, itemIds });
}

/** "Start": the whole ticket is being prepared. */
export const startTicket = (ticket: KitchenTicketView) =>
  move('kitchen.start', ticket, liveItems(ticket, 'sent'));

/** "Ready" (bump): the whole ticket is ready and leaves the board (RF-C23 tells the waiter). */
export const readyTicket = (ticket: KitchenTicketView) =>
  move(
    'kitchen.ready',
    ticket,
    liveItems(ticket).filter((id) => ticket.items.find((i) => i.itemId === id)?.status !== 'ready'),
  );

/** Recall (RF-C28): a finished ticket goes back to the board. */
export const recallTicket = (ticket: KitchenTicketView) =>
  move('kitchen.recall', ticket, liveItems(ticket, 'ready'));

/** One item one step further: sent → preparing → ready; a ready one goes back (a slip). */
export async function advanceItem(ticket: KitchenTicketView, itemId: string): Promise<void> {
  const item = ticket.items.find((i) => i.itemId === itemId);
  if (!item) return;
  if (item.status === 'sent') await move('kitchen.start', ticket, [itemId]);
  else if (item.status === 'preparing') await move('kitchen.ready', ticket, [itemId]);
  else if (item.status === 'ready') await move('kitchen.recall', ticket, [itemId]);
}

/** Served or handed over from the kitchen (RF-C22), e.g. at the bar or the pass. */
export async function serveTicket(ticket: KitchenTicketView): Promise<void> {
  const itemIds = liveItems(ticket);
  if (itemIds.length === 0) return;
  // Items moved to another order are served there.
  const byOrder = new Map<string, string[]>();
  for (const item of ticket.items) {
    if (!itemIds.includes(item.itemId)) continue;
    const orderId = item.movedToOrderId ?? ticket.orderId;
    byOrder.set(orderId, [...(byOrder.get(orderId) ?? []), item.itemId]);
  }
  for (const [orderId, ids] of byOrder) await record('items.serve', orderId, { itemIds: ids });
}

/** Prints the ticket again at the station printer, through the hub (RF-C26). */
export async function reprintTicket(ticket: KitchenTicketView): Promise<void> {
  await record('kitchen.reprint', ticket.orderId, {
    sendOperationId: ticket.sendOperationId,
    stationId: ticket.stationId,
  });
}
