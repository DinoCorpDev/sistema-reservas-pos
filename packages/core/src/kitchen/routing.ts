import type { ContentLanguage } from '../shared/languages';

/**
 * Where a send goes (RF-C21, DEC-033): each item to its stations, unless nobody would see the
 * ticket there. A station with kitchen displays is attended when one of them is online and
 * unlocked with someone's PIN; a station without displays is attended by its printer. An
 * unattended or inactive station is replaced by the station the owner chose ("if nobody is there,
 * send to…"), usually the kitchen. One step only: the replacement always receives.
 *
 * Without fresh presence data (the POS is offline) nothing is guessed: the items go to their own
 * stations, as the KDS would show them once everyone syncs.
 */

/** A kitchen display not seen for this long is not there (it pulls every 2 s). */
export const PRESENCE_WINDOW_MS = 45_000;

export interface RoutingStation {
  id: string;
  isActive: boolean;
  printerId: string | null;
  /** "If nobody is there, send to…" (null = no replacement). */
  fallbackStationId: string | null;
  /** Kitchen language of the station; null = the location's. */
  language: string | null;
}

export interface RoutingDisplay {
  terminalId: string;
  kitchenStationId: string;
}

export interface PresenceEntry {
  terminalId: string;
  unlocked: boolean;
  /** Server time of its last pull. */
  lastSeenAt: string;
  /** Who is signed in there (DEC-040); null when locked. */
  userId?: string | null;
  terminalName?: string | null;
}

/** What the last pull said about the displays, and when it arrived (device clock). */
export interface PresenceSnapshot {
  entries: readonly PresenceEntry[];
  serverTime: string;
  receivedAt: number;
}

export interface RouteSendInput {
  items: readonly { id: string; stationIds: readonly string[] }[];
  stations: readonly RoutingStation[];
  displays: readonly RoutingDisplay[];
  activePrinterIds: ReadonlySet<string>;
  presence: PresenceSnapshot | null;
  /** Now, on the device clock (same clock as `presence.receivedAt`). */
  now: number;
  kitchenLanguage: ContentLanguage;
  isLanguage: (value: string | null) => value is ContentLanguage;
  newTicketId: () => string;
}

export interface RoutedTicket {
  ticketId: string;
  stationId: string;
  language: ContentLanguage;
  replaces: string[];
}

export interface Redirect {
  fromStationId: string;
  toStationId: string;
  itemIds: string[];
  reason: 'nobody_there' | 'no_output' | 'inactive';
}

export type StationAttendance = 'attended' | 'unknown' | 'nobody_there' | 'no_output' | 'inactive';

/** Whether someone would see a ticket at this station right now. */
export function stationAttendance(
  station: RoutingStation,
  input: Pick<RouteSendInput, 'displays' | 'activePrinterIds' | 'presence' | 'now'>,
): StationAttendance {
  if (!station.isActive) return 'inactive';
  const displays = input.displays.filter((d) => d.kitchenStationId === station.id);
  if (displays.length === 0) {
    return station.printerId && input.activePrinterIds.has(station.printerId)
      ? 'attended'
      : 'no_output';
  }
  const presence = input.presence;
  if (!presence || input.now - presence.receivedAt >= PRESENCE_WINDOW_MS) return 'unknown';
  // Ages on the server's clock, plus the time since this device got the answer.
  const sinceReceived = Math.max(0, input.now - presence.receivedAt);
  const serverNow = Date.parse(presence.serverTime);
  const someone = displays.some((display) => {
    const entry = presence.entries.find((e) => e.terminalId === display.terminalId);
    if (!entry?.unlocked) return false;
    return serverNow - Date.parse(entry.lastSeenAt) + sinceReceived < PRESENCE_WINDOW_MS;
  });
  return someone ? 'attended' : 'nobody_there';
}

/** The tickets of a send and what was redirected (for the waiter's notice). */
export function routeSend(input: RouteSendInput): {
  tickets: RoutedTicket[];
  redirected: Redirect[];
} {
  const stations = new Map(input.stations.map((s) => [s.id, s]));
  const decided = new Map<string, { target: string | null; reason: Redirect['reason'] | null }>();
  const decide = (stationId: string) => {
    let decision = decided.get(stationId);
    if (decision) return decision;
    const station = stations.get(stationId);
    if (!station) {
      decision = { target: null, reason: null };
    } else {
      const attendance = stationAttendance(station, input);
      const fallback = station.fallbackStationId
        ? stations.get(station.fallbackStationId)
        : undefined;
      const canReplace = fallback !== undefined && fallback.isActive && fallback.id !== station.id;
      if (attendance === 'attended' || attendance === 'unknown') {
        decision = { target: station.id, reason: null };
      } else if (canReplace) {
        decision = { target: fallback.id, reason: attendance };
      } else {
        // No replacement: as before, an inactive station gets nothing; the others keep theirs.
        decision = { target: attendance === 'inactive' ? null : station.id, reason: null };
      }
    }
    decided.set(stationId, decision);
    return decision;
  };

  const tickets = new Map<string, RoutedTicket>();
  const redirects = new Map<string, Redirect>();
  for (const item of input.items) {
    for (const stationId of item.stationIds) {
      const { target, reason } = decide(stationId);
      if (target === null) continue;
      let ticket = tickets.get(target);
      if (!ticket) {
        const language = stations.get(target)?.language ?? null;
        ticket = {
          ticketId: input.newTicketId(),
          stationId: target,
          language: input.isLanguage(language) ? language : input.kitchenLanguage,
          replaces: [],
        };
        tickets.set(target, ticket);
      }
      if (target !== stationId && reason) {
        if (!ticket.replaces.includes(stationId)) ticket.replaces.push(stationId);
        const key = `${stationId}>${target}`;
        const redirect = redirects.get(key) ?? {
          fromStationId: stationId,
          toStationId: target,
          itemIds: [],
          reason,
        };
        if (!redirect.itemIds.includes(item.id)) redirect.itemIds.push(item.id);
        redirects.set(key, redirect);
      }
    }
  }
  return { tickets: [...tickets.values()], redirected: [...redirects.values()] };
}
