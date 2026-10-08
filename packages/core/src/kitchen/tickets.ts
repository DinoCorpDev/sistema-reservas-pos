import type { FoldState, KitchenTicketState, OrderItemState } from '../orders/state';
import type { KitchenTicketStatus } from './constants';

/**
 * Status of a kitchen ticket, derived from its items (DEC-029): the ticket has no state of its own,
 * so it can never change unless an operation changed one of its items (the Phase 3 gate).
 */

export interface TicketProgress {
  status: KitchenTicketStatus;
  preparingAt: string | null;
  readyAt: string | null;
  servedAt: string | null;
  voidedAt: string | null;
  /** When it left the station's board: ready, served or fully voided. Null while active. */
  finishedAt: string | null;
}

const byTime = (a: string, b: string) => Date.parse(a) - Date.parse(b);
const latest = (times: readonly string[]) =>
  times.length === 0 ? null : [...times].sort(byTime)[times.length - 1]!;
const earliest = (times: readonly string[]) =>
  times.length === 0 ? null : [...times].sort(byTime)[0]!;
const present = (times: readonly (string | null)[]) => times.filter((t): t is string => t !== null);

/** Items of a ticket that still exist in the fold, in the order they arrived. */
export function ticketItems(state: FoldState, ticket: KitchenTicketState): OrderItemState[] {
  return ticket.itemIds.flatMap((id) => {
    const item = state.items.get(id);
    return item ? [item] : [];
  });
}

/**
 * - voided: every item was voided;
 * - served: every live item was served;
 * - ready: every live item is ready at this station (or already served);
 * - preparing: something started; sent otherwise.
 */
export function ticketProgress(state: FoldState, ticket: KitchenTicketState): TicketProgress {
  const items = ticketItems(state, ticket);
  const live = items.filter((item) => item.prepStatus !== 'voided');
  const atStation = (item: OrderItemState) => item.kitchen[ticket.stationId];
  const preparingAt = earliest(present(live.map((item) => atStation(item)?.preparingAt ?? null)));

  if (live.length === 0) {
    const voidedAt = latest(present(items.map((item) => item.voidedAt)));
    return {
      status: 'voided',
      preparingAt,
      readyAt: null,
      servedAt: null,
      voidedAt,
      finishedAt: voidedAt,
    };
  }
  const served = live.filter((item) => item.prepStatus === 'served');
  const servedAt =
    served.length === live.length ? latest(present(served.map((i) => i.servedAt))) : null;
  const isReady = (item: OrderItemState) =>
    item.prepStatus === 'served' || atStation(item)?.status === 'ready';
  const allReady = live.every(isReady);
  // Ready = the last item that became ready (or was served without going through ready).
  const readyAt = allReady
    ? latest(present(live.map((item) => atStation(item)?.readyAt ?? item.servedAt)))
    : null;
  if (servedAt !== null) {
    return {
      status: 'served',
      preparingAt,
      readyAt,
      servedAt,
      voidedAt: null,
      finishedAt: readyAt ?? servedAt,
    };
  }
  if (allReady) {
    return {
      status: 'ready',
      preparingAt,
      readyAt,
      servedAt: null,
      voidedAt: null,
      finishedAt: readyAt,
    };
  }
  const started = live.some((item) => isReady(item) || atStation(item)?.status === 'preparing');
  return {
    status: started ? 'preparing' : 'sent',
    preparingAt,
    readyAt: null,
    servedAt: null,
    voidedAt: null,
    finishedAt: null,
  };
}

/** True when the item was voided after it reached the kitchen: the KDS strikes it (RN-13). */
export function voidedAfterSend(item: OrderItemState): boolean {
  return (
    item.voidedAt !== null &&
    item.sentAt !== null &&
    Date.parse(item.voidedAt) >= Date.parse(item.sentAt)
  );
}
