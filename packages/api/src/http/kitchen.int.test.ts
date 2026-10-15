import { newId } from '@pos/core';
import { schema as s } from '@pos/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { forgetConfigVersion } from '../services/sync';
import {
  createOtherOrganization,
  createTestApi,
  type DemoContext,
  demoSession,
  loadDemo,
  pairTerminal,
  TestDevice,
  testLine,
} from '../testing';

/**
 * Kitchen in the cloud (Phase 3, DEC-029, DEC-032): the projection of kitchen tickets, the
 * `kitchen.ticket_ready` event announced once per readiness, and the printer test page that goes
 * to the hub with the configuration and comes back as status (RF-F17).
 */

const api = createTestApi();
let demo: DemoContext;
let admin: Record<string, string>;
let pos: TestDevice;
let kds: TestDevice;
let hubToken: Record<string, string>;
let station: { kitchen: string; bar: string };
let printer: { kitchen: string; receipt: string };

type Json = Record<string, unknown>;
const json = async <T = Json>(response: Response) => (await response.json()) as T;

const push = async (device: TestDevice, operations: unknown[]) => {
  const response = await api.request('POST', '/sync/push', {
    headers: device.headers,
    body: { operations },
  });
  expect(response.status).toBe(200);
  return json<{ results: { status: string; conflicts: { code: string }[] }[] }>(response);
};

const ticketsOf = (orderId: string) =>
  api.db.select().from(s.kitchenTickets).where(eq(s.kitchenTickets.orderId, orderId));

const readyEvents = (ticketId: string) =>
  api.db
    .select()
    .from(s.outboxEvents)
    .where(
      and(
        eq(s.outboxEvents.aggregateId, ticketId),
        eq(s.outboxEvents.type, 'kitchen.ticket_ready'),
      ),
    );

beforeAll(async () => {
  demo = await loadDemo(api.db);
  admin = api.as(demoSession(demo, 'admin'));
  const stations = await api.db
    .select()
    .from(s.kitchenStations)
    .where(eq(s.kitchenStations.locationId, demo.locationId));
  station = {
    kitchen: stations.find((st) => st.name === 'Küche')!.id,
    bar: stations.find((st) => st.name === 'Bar')!.id,
  };
  const printers = await api.db
    .select()
    .from(s.printers)
    .where(eq(s.printers.locationId, demo.locationId));
  printer = {
    kitchen: printers.find((p) => p.kind === 'kitchen')!.id,
    receipt: printers.find((p) => p.kind === 'receipt')!.id,
  };
  const scope = { organizationId: demo.organizationId, locationId: demo.locationId };
  pos = new TestDevice(
    scope,
    await pairTerminal(api, admin, { prefix: 'KT1' }),
    demo.users.waiter.id,
  );
  kds = new TestDevice(
    scope,
    await pairTerminal(api, admin, {
      prefix: 'KD1',
      type: 'kds',
      kitchenStationId: station.kitchen,
    }),
    demo.users.kitchen.id,
  );
  const hub = await pairTerminal(api, admin, { prefix: 'HK', type: 'hub' });
  hubToken = { 'x-terminal-token': hub.deviceToken };
});

afterAll(async () => {
  await api.close();
});

describe('kitchen tickets in the cloud (DEC-029)', () => {
  it('projects one ticket per station, then the kitchen progress, item by item', async () => {
    const open = pos.open(newId(), 1);
    const rosti = testLine({ stationIds: [station.kitchen] });
    const beer = testLine({ name: 'Bier', course: 0, stationIds: [station.bar] });
    const add = pos.op('items.add', open.orderId, { items: [rosti, beer] });
    const send = pos.send(
      open.orderId,
      [rosti.itemId, beer.itemId],
      [station.kitchen, station.bar],
    );
    const sent = await push(pos, [open, add, send]);
    expect(sent.results.map((r) => r.status)).toEqual(['applied', 'applied', 'applied']);

    let tickets = await ticketsOf(open.orderId);
    expect(tickets.map((t) => [t.kitchenStationId, t.status, t.language]).sort()).toEqual(
      [
        [station.kitchen, 'sent', 'de'],
        [station.bar, 'sent', 'de'],
      ].sort(),
    );
    const kitchenTicket = tickets.find((t) => t.kitchenStationId === station.kitchen)!;
    expect(kitchenTicket.id).toBe(
      (send.payload as { tickets: { ticketId: string; stationId: string }[] }).tickets.find(
        (t) => t.stationId === station.kitchen,
      )!.ticketId,
    );

    kds.sees(open, add, send);
    const start = kds.kitchen('kitchen.start', open.orderId, station.kitchen, [rosti.itemId]);
    const ready = kds.kitchen('kitchen.ready', open.orderId, station.kitchen, [rosti.itemId]);
    expect((await push(kds, [start, ready])).results.map((r) => r.status)).toEqual([
      'applied',
      'applied',
    ]);
    tickets = await ticketsOf(open.orderId);
    expect(tickets.find((t) => t.id === kitchenTicket.id)).toMatchObject({
      status: 'ready',
      preparingAt: new Date(start.deviceAt),
      readyAt: new Date(ready.deviceAt),
    });
    const [item] = await api.db
      .select()
      .from(s.orderItems)
      .where(eq(s.orderItems.id, rosti.itemId));
    expect(item).toMatchObject({
      prepStatus: 'ready',
      preparingAt: new Date(start.deviceAt),
      readyAt: new Date(ready.deviceAt),
    });
    const [ticketItem] = await api.db
      .select()
      .from(s.kitchenTicketItems)
      .where(eq(s.kitchenTicketItems.kitchenTicketId, kitchenTicket.id));
    expect(ticketItem).toMatchObject({ orderItemId: rosti.itemId, status: 'ready' });

    // Announced once: resending changes nothing; a recall and a new "ready" is a new fact.
    expect(await readyEvents(kitchenTicket.id)).toHaveLength(1);
    expect((await push(kds, [ready])).results[0]!.status).toBe('duplicate');
    expect(await readyEvents(kitchenTicket.id)).toHaveLength(1);
    const recall = kds.kitchen('kitchen.recall', open.orderId, station.kitchen, [rosti.itemId]);
    await push(kds, [recall]);
    expect((await ticketsOf(open.orderId)).find((t) => t.id === kitchenTicket.id)!.status).toBe(
      'preparing',
    );
    await push(kds, [kds.kitchen('kitchen.ready', open.orderId, station.kitchen, [rosti.itemId])]);
    expect(await readyEvents(kitchenTicket.id)).toHaveLength(2);
  });

  it('only the kitchen moves tickets; the kitchen may serve (RF-C22, RNF-10)', async () => {
    const open = pos.open(newId(), 2);
    const rosti = testLine({ stationIds: [station.kitchen] });
    const add = pos.op('items.add', open.orderId, { items: [rosti] });
    const send = pos.send(open.orderId, [rosti.itemId], [station.kitchen]);
    await push(pos, [open, add, send]);

    const byWaiter = pos.kitchen('kitchen.ready', open.orderId, station.kitchen, [rosti.itemId]);
    const [waiterResult] = (await push(pos, [byWaiter])).results;
    // It happened, so it is applied, but the manager sees it (RNF-04).
    expect(waiterResult).toMatchObject({ status: 'conflict' });
    expect(waiterResult!.conflicts.map((c) => c.code)).toEqual(['approval_invalid']);

    kds.sees(open, add, send, byWaiter);
    const serve = kds.op('items.serve', open.orderId, { itemIds: [rosti.itemId] });
    expect((await push(kds, [serve])).results[0]!.status).toBe('applied');
    expect((await ticketsOf(open.orderId))[0]!.status).toBe('served');
  });
});

describe('printer test page and status (RF-F17, DEC-032)', () => {
  it('goes to the hub with the configuration and comes back as status', async () => {
    const scope = { organizationId: demo.organizationId, locationId: demo.locationId };
    forgetConfigVersion(scope);
    const before = await json<{ configVersion: string }>(
      await api.request('GET', '/pos/bootstrap', { headers: pos.headers }),
    );

    const requested = await api.request('POST', `/printers/${printer.kitchen}/test`, {
      headers: admin,
    });
    expect(requested.status).toBe(202);
    const requestedAt = (await json<{ testRequestedAt: string }>(requested)).testRequestedAt;
    expect(requestedAt).not.toBeNull();

    // The hub learns it with the new configuration.
    forgetConfigVersion(scope);
    const bootstrap = await json<{
      configVersion: string;
      printers: { id: string; testRequestedAt: string | null; host: string }[];
      stations: { id: string; printerId: string | null; alertAfterMinutes: number | null }[];
    }>(await api.request('GET', '/pos/bootstrap', { headers: hubToken }));
    expect(bootstrap.configVersion).not.toBe(before.configVersion);
    expect(bootstrap.printers.find((p) => p.id === printer.kitchen)!.testRequestedAt).toBe(
      requestedAt,
    );
    expect(bootstrap.stations.find((st) => st.id === station.kitchen)!.printerId).toBe(
      printer.kitchen,
    );
    expect(bootstrap.stations.find((st) => st.id === station.bar)!.alertAfterMinutes).toBe(5);

    const at = new Date().toISOString();
    const report = await api.request('POST', '/sync/printer-status', {
      headers: hubToken,
      body: {
        printers: [
          { printerId: printer.kitchen, ok: true, error: null, at, test: true },
          { printerId: printer.receipt, ok: false, error: 'ECONNREFUSED 192.168.1.50:9100', at },
        ],
      },
    });
    expect(report.status).toBe(200);
    expect(await json(report)).toEqual({ updated: 2 });

    const printers = await json<
      {
        id: string;
        lastTestOk: boolean | null;
        lastTestAt: string | null;
        lastError: string | null;
      }[]
    >(await api.request('GET', '/printers', { headers: admin }));
    expect(printers.find((p) => p.id === printer.kitchen)).toMatchObject({
      lastTestOk: true,
      lastTestAt: at,
      lastError: null,
    });
    expect(printers.find((p) => p.id === printer.receipt)!.lastError).toContain('ECONNREFUSED');

    // Printer status is not configuration: terminals do not download it again.
    forgetConfigVersion(scope);
    const after = await json<{ configVersion: string }>(
      await api.request('GET', '/pos/bootstrap', { headers: pos.headers }),
    );
    expect(after.configVersion).toBe(bootstrap.configVersion);
  });

  it('only the hub reports, and only its own printers; other organizations get 404', async () => {
    const at = new Date().toISOString();
    const fromPos = await api.request('POST', '/sync/printer-status', {
      headers: pos.headers,
      body: { printers: [{ printerId: printer.kitchen, ok: true, error: null, at }] },
    });
    expect(fromPos.status).toBe(403);

    const other = await createOtherOrganization(api.db, 'Kitchen Other');
    const foreign = await api.db
      .insert(s.printers)
      .values({
        organizationId: other.organizationId,
        locationId: other.locationId,
        name: 'Fremd',
        kind: 'kitchen',
        host: '10.0.0.9',
      })
      .$returningId();
    const ignored = await api.request('POST', '/sync/printer-status', {
      headers: hubToken,
      body: { printers: [{ printerId: foreign[0]!.id, ok: false, error: 'x', at }] },
    });
    expect(await json(ignored)).toEqual({ updated: 0 });

    const otherAdmin = api.as(other.session);
    const crossed = await api.request('POST', `/printers/${printer.kitchen}/test`, {
      headers: otherAdmin,
    });
    expect(crossed.status).toBe(404);
  });
});

describe('stations nobody attends (DEC-033)', () => {
  type Presence = { terminalId: string; unlocked: boolean; userId: string | null }[];
  const pullAs = async (headers: Record<string, string>) => {
    const response = await api.request('GET', '/sync/pull?after=0&limit=1', { headers });
    expect(response.status).toBe(200);
    return json<{ presence: Presence; serverTime: string }>(response);
  };

  it('a kitchen display says on every pull whether someone is there; the POS sees it', async () => {
    await pullAs({
      ...kds.headers,
      'x-presence': 'unlocked',
      'x-presence-user': demo.users.kitchen.id,
    });
    let seen = await pullAs(pos.headers);
    expect(seen.presence).toContainEqual(
      expect.objectContaining({
        terminalId: kds.terminal.id,
        unlocked: true,
        userId: demo.users.kitchen.id,
      }),
    );

    await pullAs({ ...kds.headers, 'x-presence': 'locked' });
    seen = await pullAs(pos.headers);
    expect(seen.presence).toContainEqual(
      expect.objectContaining({ terminalId: kds.terminal.id, unlocked: false, userId: null }),
    );

    // Every device reports who is signed in, so a person uses one device at a time (DEC-040).
    await pullAs({
      ...pos.headers,
      'x-presence': 'unlocked',
      'x-presence-user': demo.users.cashier.id,
    });
    seen = await pullAs(pos.headers);
    expect(seen.presence).toContainEqual(
      expect.objectContaining({
        terminalId: pos.terminal.id,
        unlocked: true,
        userId: demo.users.cashier.id,
        terminalName: expect.any(String),
      }),
    );

    // The bootstrap names the displays of each station and the replacements.
    const bootstrap = await json<{
      kitchenDisplays: { terminalId: string; kitchenStationId: string | null }[];
      stations: { id: string; fallbackStationId: string | null }[];
    }>(await api.request('GET', '/pos/bootstrap', { headers: pos.headers }));
    expect(bootstrap.kitchenDisplays).toContainEqual(
      expect.objectContaining({ terminalId: kds.terminal.id, kitchenStationId: station.kitchen }),
    );
    expect(bootstrap.stations.find((st) => st.id === station.bar)).toHaveProperty(
      'fallbackStationId',
    );
  });

  it('a display without a fixed station says which one it chose; locked, none (DEC-042)', async () => {
    const shared = await pairTerminal(api, admin, { prefix: 'KD5', type: 'kds' });
    const headers = { 'x-terminal-token': shared.deviceToken };
    await pullAs({
      ...headers,
      'x-presence': 'unlocked',
      'x-presence-user': demo.users.kitchen.id,
      'x-presence-station': station.bar,
    });
    let seen = await pullAs(pos.headers);
    expect(seen.presence).toContainEqual(
      expect.objectContaining({ terminalId: shared.id, unlocked: true, stationId: station.bar }),
    );
    const bootstrap = await json<{
      kitchenDisplays: { terminalId: string; kitchenStationId: string | null }[];
    }>(await api.request('GET', '/pos/bootstrap', { headers: pos.headers }));
    expect(bootstrap.kitchenDisplays).toContainEqual(
      expect.objectContaining({ terminalId: shared.id, kitchenStationId: null }),
    );

    await pullAs({ ...headers, 'x-presence': 'locked', 'x-presence-station': station.bar });
    seen = await pullAs(pos.headers);
    expect(seen.presence).toContainEqual(
      expect.objectContaining({ terminalId: shared.id, unlocked: false, stationId: null }),
    );

    // Through the hub as well; an older hub that does not send it means no station.
    const now = new Date();
    const reported = await api.request('POST', '/sync/presence', {
      headers: hubToken,
      body: {
        entries: [
          {
            terminalId: shared.id,
            unlocked: true,
            userId: demo.users.kitchen.id,
            stationId: station.kitchen,
            lastSeenAt: now.toISOString(),
          },
        ],
      },
    });
    expect(await json(reported)).toEqual({ stored: 1 });
    seen = await pullAs(pos.headers);
    expect(seen.presence).toContainEqual(
      expect.objectContaining({ terminalId: shared.id, stationId: station.kitchen }),
    );
  });

  it('a pull is the heartbeat: last seen and version, at most once a minute (RNF-16, RNF-17)', async () => {
    const device = await pairTerminal(api, admin, { prefix: 'HB', type: 'kds' });
    const headers = { 'x-terminal-token': device.deviceToken };
    const row = async () => {
      const [terminal] = await api.db
        .select({ lastSeenAt: s.terminals.lastSeenAt, appVersion: s.terminals.appVersion })
        .from(s.terminals)
        .where(eq(s.terminals.id, device.id));
      return terminal!;
    };
    // Paired a minute ago: the next pull refreshes the heartbeat and records the version.
    await api.db
      .update(s.terminals)
      .set({ lastSeenAt: new Date(Date.now() - 120_000) })
      .where(eq(s.terminals.id, device.id));
    await pullAs({ ...headers, 'x-app-version': '1.4.0+abc123', 'x-presence': 'locked' });
    const first = await row();
    expect(first.appVersion).toBe('1.4.0+abc123');
    expect(Date.now() - first.lastSeenAt!.getTime()).toBeLessThan(10_000);
    const seen = await pullAs(pos.headers);
    expect(seen.presence).toContainEqual(
      expect.objectContaining({ terminalId: device.id, appVersion: '1.4.0+abc123' }),
    );

    // Within the minute nothing is written; a new version is, at once. A bad one is ignored.
    await pullAs({ ...headers, 'x-app-version': '1.4.0+abc123' });
    expect((await row()).lastSeenAt).toEqual(first.lastSeenAt);
    await pullAs({ ...headers, 'x-app-version': '1.5.0' });
    expect((await row()).appVersion).toBe('1.5.0');
    await pullAs({ ...headers, 'x-app-version': 'bad version <script>' });
    expect((await row()).appVersion).toBe('1.5.0');

    const health = await api.request('GET', '/health');
    expect(await json(health)).toMatchObject({ version: expect.any(String) });
  });

  it('the hub hands over its displays only; a late report never wins; others never see it', async () => {
    const barDisplay = await pairTerminal(api, admin, {
      prefix: 'KD3',
      type: 'kds',
      kitchenStationId: station.bar,
    });
    const other = await createOtherOrganization(api.db, 'Presence Other');
    const foreign = await api.db
      .insert(s.terminals)
      .values({
        organizationId: other.organizationId,
        locationId: other.locationId,
        name: 'Fremd KDS',
        type: 'kds',
        orderNumberPrefix: 'FX',
      })
      .$returningId();
    const now = new Date();
    const entry = (terminalId: string, unlocked: boolean, at: Date) => ({
      terminalId,
      unlocked,
      userId: unlocked ? demo.users.kitchen.id : null,
      lastSeenAt: at.toISOString(),
    });

    const fromPos = await api.request('POST', '/sync/presence', {
      headers: pos.headers,
      body: { entries: [entry(barDisplay.id, true, now)] },
    });
    expect(fromPos.status).toBe(403);

    const reported = await api.request('POST', '/sync/presence', {
      headers: hubToken,
      body: { entries: [entry(barDisplay.id, true, now), entry(foreign[0]!.id, true, now)] },
    });
    expect(await json(reported)).toEqual({ stored: 1 });

    const late = await api.request('POST', '/sync/presence', {
      headers: hubToken,
      body: { entries: [entry(barDisplay.id, false, new Date(now.getTime() - 60_000))] },
    });
    expect(await json(late)).toEqual({ stored: 1 });
    const seen = await pullAs(pos.headers);
    expect(seen.presence).toContainEqual(
      expect.objectContaining({ terminalId: barDisplay.id, unlocked: true }),
    );
    expect(seen.presence.map((p) => p.terminalId)).not.toContain(foreign[0]!.id);

    // A terminal of the other organization sees none of it.
    const otherAdmin = api.as(other.session);
    const otherPos = await pairTerminal(api, otherAdmin, { prefix: 'OP' });
    const theirs = await pullAs({ 'x-terminal-token': otherPos.deviceToken });
    expect(theirs.presence).toEqual([]);
  });

  it('a stand-in ticket carries the items of the station it replaces', async () => {
    const open = pos.open(newId(), 3);
    const beer = testLine({ name: 'Bier', stationIds: [station.bar] });
    const rosti = testLine({ stationIds: [station.kitchen] });
    const add = pos.op('items.add', open.orderId, { items: [beer, rosti] });
    const ticketId = newId();
    const send = pos.op('items.send', open.orderId, {
      itemIds: [beer.itemId, rosti.itemId],
      tickets: [{ ticketId, stationId: station.kitchen, language: 'de', replaces: [station.bar] }],
    });
    const sent = await push(pos, [open, add, send]);
    expect(sent.results.map((r) => r.status)).toEqual(['applied', 'applied', 'applied']);

    const tickets = await ticketsOf(open.orderId);
    expect(tickets.map((t) => [t.id, t.kitchenStationId])).toEqual([[ticketId, station.kitchen]]);
    const items = await api.db
      .select({ orderItemId: s.kitchenTicketItems.orderItemId })
      .from(s.kitchenTicketItems)
      .where(eq(s.kitchenTicketItems.kitchenTicketId, ticketId));
    expect(items.map((i) => i.orderItemId).sort()).toEqual([beer.itemId, rosti.itemId].sort());
  });

  it('the replacement is another station of the location; one in use is not deleted', async () => {
    const self = await api.request('PATCH', `/kitchen-stations/${station.bar}`, {
      headers: admin,
      body: { fallbackStationId: station.bar },
    });
    expect(self.status).toBe(422);
    const unknown = await api.request('PATCH', `/kitchen-stations/${station.bar}`, {
      headers: admin,
      body: { fallbackStationId: newId() },
    });
    expect(unknown.status).toBe(404);

    const set = await api.request('PATCH', `/kitchen-stations/${station.bar}`, {
      headers: admin,
      body: { fallbackStationId: station.kitchen },
    });
    expect(set.status).toBe(200);
    expect(await json(set)).toMatchObject({ fallbackStationId: station.kitchen });

    const created = await api.request('POST', '/kitchen-stations', {
      headers: admin,
      body: { name: 'Grill DEC-033' },
    });
    expect(created.status).toBe(201);
    const grill = await json<{ id: string }>(created);
    await api.request('PATCH', `/kitchen-stations/${station.bar}`, {
      headers: admin,
      body: { fallbackStationId: grill.id },
    });
    const removed = await api.request('DELETE', `/kitchen-stations/${grill.id}`, {
      headers: admin,
    });
    expect(removed.status).toBe(409);
    await api.request('PATCH', `/kitchen-stations/${station.bar}`, {
      headers: admin,
      body: { fallbackStationId: station.kitchen },
    });
    const removedNow = await api.request('DELETE', `/kitchen-stations/${grill.id}`, {
      headers: admin,
    });
    expect(removedNow.status).toBe(204);
  });
});
