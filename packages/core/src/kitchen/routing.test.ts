import { describe, expect, it } from 'vitest';
import { foldOperations } from '../orders/reducer';
import { ticketKey } from '../orders/state';
import { CONTEXT, Device, line, STATION, TERMINAL, uid } from '../orders/test-kit';
import { isContentLanguage } from '../shared/languages';
import { ticketView } from './board';
import { KITCHEN_LABELS } from './labels';
import { renderKitchenTicket } from './render';
import {
  PRESENCE_WINDOW_MS,
  type PresenceSnapshot,
  type RouteSendInput,
  routeSend,
  type RoutingStation,
  stationAttendance,
} from './routing';

/**
 * Nobody at the bar? Its items go to the kitchen (DEC-033). The decision is made on the POS when
 * sending and frozen in the operation, so every node folds the same tickets.
 */

const NOW = Date.UTC(2026, 9, 7, 19, 0, 0);
const BAR_TABLET = uid(900);
const PASTRY_TABLET = uid(901);

const stations: RoutingStation[] = [
  {
    id: STATION.kitchen,
    isActive: true,
    printerId: uid(800),
    fallbackStationId: null,
    language: null,
  },
  {
    id: STATION.bar,
    isActive: true,
    printerId: null,
    fallbackStationId: STATION.kitchen,
    language: null,
  },
  {
    id: STATION.dessert,
    isActive: true,
    printerId: null,
    fallbackStationId: STATION.kitchen,
    language: 'fr',
  },
];

const presence = (
  entries: PresenceSnapshot['entries'],
  receivedAgoMs = 1_000,
): PresenceSnapshot => ({
  entries,
  serverTime: new Date(NOW - receivedAgoMs).toISOString(),
  receivedAt: NOW - receivedAgoMs,
});

const seen = (terminalId: string, agoMs: number, unlocked = true) => ({
  terminalId,
  unlocked,
  lastSeenAt: new Date(NOW - agoMs).toISOString(),
});

let ids = 0;
function input(overrides: Partial<RouteSendInput> = {}): RouteSendInput {
  return {
    items: [
      { id: 'beer', stationIds: [STATION.bar] },
      { id: 'cake', stationIds: [STATION.dessert] },
      { id: 'rosti', stationIds: [STATION.kitchen] },
    ],
    stations,
    displays: [
      { terminalId: BAR_TABLET, kitchenStationId: STATION.bar },
      { terminalId: PASTRY_TABLET, kitchenStationId: STATION.dessert },
    ],
    activePrinterIds: new Set([uid(800)]),
    presence: presence([seen(BAR_TABLET, 2_000), seen(PASTRY_TABLET, 3_000)]),
    now: NOW,
    kitchenLanguage: 'de',
    isLanguage: (value): value is 'de' => isContentLanguage(value),
    newTicketId: () => `ticket-${++ids}`,
    ...overrides,
  };
}

const byStation = (result: ReturnType<typeof routeSend>) =>
  Object.fromEntries(result.tickets.map((t) => [t.stationId, t.replaces]));

describe('who is at a station (DEC-033)', () => {
  it('a station with an unlocked display seen recently is attended', () => {
    expect(stationAttendance(stations[1]!, input())).toBe('attended');
  });

  it('a locked display, or one not seen for the window, means nobody is there', () => {
    expect(
      stationAttendance(
        stations[1]!,
        input({ presence: presence([seen(BAR_TABLET, 1_000, false)]) }),
      ),
    ).toBe('nobody_there');
    expect(
      stationAttendance(
        stations[1]!,
        input({ presence: presence([seen(BAR_TABLET, PRESENCE_WINDOW_MS)]) }),
      ),
    ).toBe('nobody_there');
    // Seen 40 s before the answer that arrived 5 s ago: 45 s, gone.
    expect(
      stationAttendance(
        stations[1]!,
        input({ presence: presence([seen(BAR_TABLET, 45_000)], 5_000) }),
      ),
    ).toBe('nobody_there');
  });

  it('without fresh presence (the POS is offline) nothing is guessed', () => {
    expect(stationAttendance(stations[1]!, input({ presence: null }))).toBe('unknown');
    expect(
      stationAttendance(stations[1]!, input({ presence: presence([], PRESENCE_WINDOW_MS) })),
    ).toBe('unknown');
  });

  it('a station without displays is attended by its printer; without either, by nobody', () => {
    expect(stationAttendance(stations[0]!, input())).toBe('attended');
    expect(stationAttendance(stations[0]!, input({ activePrinterIds: new Set<string>() }))).toBe(
      'no_output',
    );
    expect(stationAttendance({ ...stations[1]!, isActive: false }, input())).toBe('inactive');
  });
});

describe('routing a send (RF-C21, DEC-033)', () => {
  it('everyone there: each item to its own station', () => {
    const result = routeSend(input());
    expect(byStation(result)).toEqual({
      [STATION.bar]: [],
      [STATION.dessert]: [],
      [STATION.kitchen]: [],
    });
    expect(result.redirected).toEqual([]);
    // The ticket keeps the station's own kitchen language.
    expect(result.tickets.find((t) => t.stationId === STATION.dessert)!.language).toBe('fr');
  });

  it('nobody at the bar: the beer goes to the kitchen, which stands in for the bar', () => {
    const result = routeSend(
      input({ presence: presence([seen(BAR_TABLET, 2_000, false), seen(PASTRY_TABLET, 1_000)]) }),
    );
    expect(byStation(result)).toEqual({
      [STATION.kitchen]: [STATION.bar],
      [STATION.dessert]: [],
    });
    expect(result.redirected).toEqual([
      {
        fromStationId: STATION.bar,
        toStationId: STATION.kitchen,
        itemIds: ['beer'],
        reason: 'nobody_there',
      },
    ]);
  });

  it('an inactive station or one without any output goes to its replacement', () => {
    const inactive = routeSend(
      input({
        stations: stations.map((s) => (s.id === STATION.dessert ? { ...s, isActive: false } : s)),
      }),
    );
    expect(inactive.redirected.map((r) => [r.fromStationId, r.reason])).toEqual([
      [STATION.dessert, 'inactive'],
    ]);
    const noOutput = routeSend(input({ displays: [] }));
    expect(byStation(noOutput)).toEqual({ [STATION.kitchen]: [STATION.bar, STATION.dessert] });
  });

  it('without a replacement the station keeps its items (an inactive one gets none)', () => {
    const lonely = stations.map((s) => ({ ...s, fallbackStationId: null }));
    expect(byStation(routeSend(input({ stations: lonely, presence: presence([]) })))).toEqual({
      [STATION.bar]: [],
      [STATION.dessert]: [],
      [STATION.kitchen]: [],
    });
    expect(
      byStation(
        routeSend(
          input({
            stations: lonely.map((s) => (s.id === STATION.bar ? { ...s, isActive: false } : s)),
          }),
        ),
      ),
    ).toEqual({ [STATION.dessert]: [], [STATION.kitchen]: [] });
  });

  it('offline POS: the items go to their own stations', () => {
    expect(routeSend(input({ presence: null })).redirected).toEqual([]);
  });
});

describe('a redirected ticket in the fold, on the KDS and on paper', () => {
  it('the item lands on the stand-in ticket once, marked with the station it belongs to', () => {
    const waiter = new Device(TERMINAL.H1);
    const open = waiter.open();
    const beer = line({ name: 'Bier', course: 0, stationIds: [STATION.bar] });
    // A menu for kitchen and pastry: the pastry is replaced by the kitchen, one line only.
    const menu = line({ name: 'Tagesmenü', stationIds: [STATION.kitchen, STATION.dessert] });
    const add = waiter.add(open.orderId, beer, menu);
    const send = waiter.sendRouted(
      open.orderId,
      [{ stationId: STATION.kitchen, replaces: [STATION.bar, STATION.dessert] }],
      beer.itemId,
      menu.itemId,
    );
    const state = foldOperations([open, add, send], CONTEXT);
    expect(state.tickets.size).toBe(1);
    const ticket = state.tickets.get(ticketKey(send.id, STATION.kitchen))!;
    expect(ticket.itemIds).toEqual([beer.itemId, menu.itemId]);
    expect(Object.keys(state.items.get(menu.itemId)!.kitchen)).toEqual([STATION.kitchen]);

    const view = ticketView(state, ticket, { now: send.deviceAt, alertAfterMinutes: 12 });
    expect(view.items.map((i) => [i.name, i.fromStationId])).toEqual([
      ['Bier', STATION.bar],
      ['Tagesmenü', null],
    ]);
    const doc = renderKitchenTicket(view, {
      kind: 'ticket',
      width: 48,
      labels: KITCHEN_LABELS.de,
      timeZone: 'Europe/Zurich',
      stationName: 'Küche',
      tableLabel: '1',
      waiterName: null,
      at: send.deviceAt,
      stationNames: { [STATION.bar]: 'Bar' },
    });
    expect(doc.lines.map((l) => l.text)).toContain('   (für Bar)');
  });

  it('a version 1 send is unchanged by the stand-in rule', () => {
    const waiter = new Device(TERMINAL.H1);
    const open = waiter.open();
    const beer = line({ stationIds: [STATION.bar] });
    const add = waiter.add(open.orderId, beer);
    const send = waiter.op('items.send', open.orderId, { itemIds: [beer.itemId] } as never, {
      schemaVersion: 1,
    });
    const state = foldOperations([open, add, send], CONTEXT);
    expect([...state.tickets.values()].map((t) => [t.stationId, t.replaces])).toEqual([
      [STATION.bar, []],
    ]);
  });
});
