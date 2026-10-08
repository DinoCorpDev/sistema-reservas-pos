import type { Channel } from '../shared/channels';
import type { ContentLanguage } from '../shared/languages';
import type { FoldState, KitchenTicketState } from '../orders/state';
import type { KitchenAllergen, KitchenCatalog } from './catalog';
import type { KitchenItemStatus } from './constants';
import { type TicketProgress, ticketItems, ticketProgress } from './tickets';

/**
 * The board of one kitchen station (RF-C20, RF-C24, RF-C28), derived from the fold: the KDS
 * renders it and the hub prints from it. Pure: the current time comes in as an argument.
 */

export interface KitchenItemView {
  itemId: string;
  orderId: string;
  quantity: number;
  name: string;
  variantName: string | null;
  modifiers: { name: string; quantity: number }[];
  note: string | null;
  seat: number | null;
  course: number;
  allergens: KitchenAllergen[];
  /** Progress at this station, or the item's final state. */
  status: KitchenItemStatus | 'served' | 'voided';
  voidedAt: string | null;
  /** The item was moved to another order after it was sent (transfer, merge, split). */
  movedToOrderId: string | null;
}

export interface KitchenTicketView extends TicketProgress {
  key: string;
  id: string | null;
  sendOperationId: string;
  stationId: string;
  orderId: string;
  displayNumber: string;
  tableId: string | null;
  channel: Channel;
  waiterUserId: string | null;
  sentAt: string;
  sentByUserId: string;
  language: ContentLanguage | null;
  reprintCount: number;
  /** Courses on the ticket, ascending. */
  courses: number[];
  items: KitchenItemView[];
  /** Whole minutes since it was sent: until now while active, until it finished afterwards. */
  elapsedMinutes: number;
  /** Past the station's threshold while still active (RF-C24). */
  alert: boolean;
  /** Something on it was voided after it reached the kitchen (RN-13). */
  hasStorno: boolean;
}

export interface StationBoard {
  /** Still to prepare, oldest first. */
  active: KitchenTicketView[];
  /** Recall (RF-C28): finished within the window, most recent first. */
  done: KitchenTicketView[];
}

const MINUTE_MS = 60_000;

export interface TicketViewOptions {
  /** Current instant (ISO). */
  now: string;
  /** Delay alert of the station, or the location default (RF-C24). */
  alertAfterMinutes: number;
  /** Names and allergens in the kitchen language; without it, the frozen names. */
  catalog?: KitchenCatalog;
}

export function ticketView(
  state: FoldState,
  ticket: KitchenTicketState,
  options: TicketViewOptions,
): KitchenTicketView {
  const progress = ticketProgress(state, ticket);
  const order = state.orders.get(ticket.orderId);
  const catalog = options.catalog;
  const items: KitchenItemView[] = ticketItems(state, ticket).map((item) => {
    const atStation = item.kitchen[ticket.stationId];
    const status: KitchenItemView['status'] =
      item.prepStatus === 'voided' || item.prepStatus === 'served'
        ? item.prepStatus
        : (atStation?.status ?? 'sent');
    return {
      itemId: item.id,
      orderId: item.orderId,
      quantity: item.quantity,
      name: catalog ? catalog.productName(item.productId, item.name) : item.name,
      variantName: catalog
        ? catalog.variantName(item.variantId, item.variantName)
        : item.variantName,
      modifiers: item.modifiers.map((m) => ({
        name: catalog ? catalog.modifierName(m.modifierId, m.name) : m.name,
        quantity: m.quantity,
      })),
      note: item.note,
      seat: item.seat,
      course: item.course,
      allergens: catalog
        ? catalog.allergens(
            item.productId,
            item.modifiers.map((m) => m.modifierId),
          )
        : [],
      status,
      voidedAt: item.voidedAt,
      movedToOrderId: item.orderId === ticket.orderId ? null : item.orderId,
    };
  });
  const end = progress.finishedAt ?? options.now;
  const elapsedMinutes = Math.max(
    0,
    Math.floor((Date.parse(end) - Date.parse(ticket.sentAt)) / MINUTE_MS),
  );
  return {
    ...progress,
    key: ticket.key,
    id: ticket.id,
    sendOperationId: ticket.sendOperationId,
    stationId: ticket.stationId,
    orderId: ticket.orderId,
    displayNumber: order?.displayNumber ?? '',
    tableId: order?.tableId ?? null,
    channel: order?.channel ?? 'table',
    waiterUserId: order?.waiterUserId ?? null,
    sentAt: ticket.sentAt,
    sentByUserId: ticket.sentByUserId,
    language: ticket.language,
    reprintCount: ticket.reprintCount,
    courses: [...new Set(items.map((i) => i.course))].sort((a, b) => a - b),
    items,
    elapsedMinutes,
    alert: progress.finishedAt === null && elapsedMinutes >= options.alertAfterMinutes,
    hasStorno: items.some((i) => i.status === 'voided'),
  };
}

export interface StationBoardOptions extends TicketViewOptions {
  /** How far back the recall goes (RF-C28); default 3 hours. */
  doneWithinMinutes?: number;
}

export function stationBoard(
  state: FoldState,
  stationId: string,
  options: StationBoardOptions,
): StationBoard {
  const doneSince = Date.parse(options.now) - (options.doneWithinMinutes ?? 180) * MINUTE_MS;
  const active: KitchenTicketView[] = [];
  const done: KitchenTicketView[] = [];
  for (const ticket of state.tickets.values()) {
    if (ticket.stationId !== stationId) continue;
    const view = ticketView(state, ticket, options);
    if (view.finishedAt === null) active.push(view);
    else if (Date.parse(view.finishedAt) >= doneSince) done.push(view);
  }
  const byKey = (a: KitchenTicketView, b: KitchenTicketView) => (a.key < b.key ? -1 : 1);
  active.sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt) || byKey(a, b));
  done.sort((a, b) => Date.parse(b.finishedAt!) - Date.parse(a.finishedAt!) || byKey(a, b));
  return { active, done };
}
