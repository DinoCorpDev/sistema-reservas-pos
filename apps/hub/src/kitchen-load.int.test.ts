import { createApiApp, sync } from '@pos/api';
import {
  createTestApi,
  type DemoContext,
  demoSession,
  loadDemo,
  type PairedTerminal,
  pairTerminal,
  TestDevice,
  testLine,
} from '@pos/api/testing';
import {
  type FoldState,
  foldOperations,
  itemsOf,
  newId,
  type Operation,
  parseLocationSettings,
  stationBoard,
  ticketProgress,
} from '@pos/core';
import { createDb, schema as s } from '@pos/db';
import { hubTestDatabaseUrl } from '@pos/db/testing';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import type { CloudFetch } from './cloud';
import { syncConfig } from './config-sync';
import { forwardToCloud, pullFromCloud } from './forwarder';
import { PrintConfigCache } from './printing/config';
import { type FakePrinter, startFakePrinter } from './printing/fake-printer';
import { tcpTransport } from './printing/transport';
import { PrintWorker } from './printing/worker';
import { StateFile } from './state';
import { resetHubLog } from './test-support';

/**
 * THE PHASE 3 GATE: a peak hour of 60 orders (RNF-08: 10 terminals, 60 orders per hour) runs
 * through the hub, three kitchen displays and the station printers, compressed into one test.
 * Waiters open tables, order in two courses for three stations, void, transfer, march, serve
 * and pay; the kitchen starts, finishes and recalls tickets. Batches arrive late, twice, and
 * some terminals talk to the cloud directly; the hub is restarted in the middle.
 *
 * Checked at every step and at the end: no ticket is lost (every send reaches exactly the
 * station it was routed to), no ticket changes state unless an operation on its items says so,
 * every station ticket and storno slip prints exactly once, and the cloud ends up with the same
 * tickets as the kitchen.
 */

const ORDERS = 60;
const POS_COUNT = 10;

const cloud = createTestApi();
const hubConnection = createDb(hubTestDatabaseUrl(), { connectionLimit: 8 });
const hubDb = hubConnection.db;
const state = new StateFile(null);
const config = new PrintConfigCache(null);
let demo: DemoContext;
let scope: { organizationId: string; locationId: string };
let hubTerminal: PairedTerminal;
let cloudFetch: CloudFetch;
let stations: { kitchen: string; bar: string; dessert: string };
let printers: { kitchen: FakePrinter; dessert: FakePrinter };
const settings = parseLocationSettings({});

const hubApp = createApp({
  pingDatabase: null,
  connectedClients: () => 0,
  api: createApiApp({
    db: hubDb,
    modules: 'sync',
    node: { kind: 'hub', authority: true, configVersion: () => state.value.cloudConfigVersion },
  }),
});

/** Deterministic pseudo-random numbers (mulberry32): the same run every time. */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const next = random(2026);
const chance = (p: number) => next() < p;
const pick = <T>(items: readonly T[]): T | undefined =>
  items.length === 0 ? undefined : items[Math.floor(next() * items.length)];

/** A device with its own log: it pushes to the hub (or the cloud) and pulls from the hub. */
class SimDevice {
  readonly known = new Map<string, Operation>();
  cursor = 0;
  /** Operations added since the last invariant check (own and pulled). */
  fresh: Operation[] = [];

  constructor(readonly device: TestDevice) {}

  private learn(ops: readonly Operation[]) {
    for (const op of ops) {
      if (this.known.has(op.id)) continue;
      this.known.set(op.id, op);
      this.fresh.push(op);
    }
  }

  async push(raw: readonly unknown[], via: 'hub' | 'cloud' = 'hub') {
    // The test devices build operations loosely typed; they are real operations.
    const ops = raw as Operation[];
    this.learn(ops);
    const body = JSON.stringify({ operations: ops });
    const headers = {
      'content-type': 'application/json',
      'x-terminal-token': this.device.terminal.deviceToken,
    };
    const response =
      via === 'hub'
        ? await hubApp.request('/api/v1/sync/push', { method: 'POST', headers, body })
        : await cloud.app.request('/api/v1/sync/push', { method: 'POST', headers, body });
    expect(response.status).toBe(200);
    const { results } = (await response.json()) as { results: { status: string }[] };
    expect(results.every((r) => r.status !== 'rejected')).toBe(true);
  }

  async pull() {
    for (;;) {
      const response = await hubApp.request(`/api/v1/sync/pull?after=${this.cursor}&limit=500`, {
        headers: { 'x-terminal-token': this.device.terminal.deviceToken },
      });
      const page = (await response.json()) as {
        operations: { operation: Operation }[];
        cursor: number;
        hasMore: boolean;
      };
      const ops = page.operations.map((p) => p.operation);
      this.device.sees(...ops);
      this.learn(ops);
      this.cursor = page.cursor;
      if (!page.hasMore) break;
    }
  }

  fold(): FoldState {
    return foldOperations([...this.known.values()], { settings });
  }
}

/** Items whose kitchen state an operation can change (the gate's "explained" check). */
function itemsActedOn(op: Operation, state: FoldState): Set<string> {
  switch (op.type) {
    case 'items.send':
    case 'items.serve':
    case 'kitchen.start':
    case 'kitchen.ready':
    case 'kitchen.recall':
      return new Set(op.payload.itemIds);
    case 'item.void':
      return new Set([op.payload.itemId, op.payload.voidedItemId]);
    case 'order.void':
      return new Set(itemsOf(state, op.orderId).map((i) => i.id));
    default:
      return new Set();
  }
}

/** A kitchen display of one station, with the gate's invariants on every refresh. */
class SimKds extends SimDevice {
  private statuses = new Map<string, string>();
  private active = new Set<string>();
  checks = 0;

  constructor(
    device: TestDevice,
    readonly stationId: string,
  ) {
    super(device);
  }

  /** Pulls and verifies: no ticket changed without an operation; none vanished while active. */
  async refresh(now: string) {
    await this.pull();
    const state = this.fold();
    const board = stationBoard(state, this.stationId, {
      now,
      alertAfterMinutes: 12,
      doneWithinMinutes: 24 * 60,
    });
    const after = new Map<string, string>();
    for (const ticket of [...board.active, ...board.done]) {
      expect(ticket.stationId).toBe(this.stationId);
      expect(after.has(ticket.key), `ticket ${ticket.key} twice on the board`).toBe(false);
      after.set(ticket.key, ticket.status);
    }
    const acted = new Set(this.fresh.flatMap((op) => [...itemsActedOn(op, state)]));
    const sends = new Set(this.fresh.filter((op) => op.type === 'items.send').map((op) => op.id));
    for (const [key, status] of after) {
      const before = this.statuses.get(key);
      if (before === status) continue;
      const ticket = state.tickets.get(key)!;
      const explained =
        before === undefined
          ? sends.has(ticket.sendOperationId)
          : ticket.itemIds.some((id) => acted.has(id));
      expect(explained, `ticket ${key} went ${before} → ${status} on its own`).toBe(true);
    }
    for (const key of this.active) {
      expect(after.has(key), `active ticket ${key} disappeared`).toBe(true);
    }
    this.statuses = after;
    this.active = new Set(board.active.map((t) => t.key));
    this.fresh = [];
    this.checks += 1;
    return { state, board };
  }
}

interface SimOrder {
  id: string;
  pos: SimDevice;
  phase: 'course1' | 'course2' | 'paying' | 'closed';
}

beforeAll(async () => {
  await resetHubLog(hubDb);
  demo = await loadDemo(cloud.db);
  scope = { organizationId: demo.organizationId, locationId: demo.locationId };
  const admin = cloud.as(demoSession(demo, 'admin'));
  const rows = await cloud.db
    .select()
    .from(s.kitchenStations)
    .where(eq(s.kitchenStations.locationId, demo.locationId));
  stations = {
    kitchen: rows.find((r) => r.name === 'Küche')!.id,
    bar: rows.find((r) => r.name === 'Bar')!.id,
    dessert: rows.find((r) => r.name === 'Patisserie')!.id,
  };
  // Kitchen and pastry print their tickets; the bar works with its KDS only.
  printers = { kitchen: await startFakePrinter(), dessert: await startFakePrinter() };
  const [kitchenPrinter] = await cloud.db
    .select()
    .from(s.printers)
    .where(and(eq(s.printers.locationId, demo.locationId), eq(s.printers.kind, 'kitchen')));
  await cloud.db
    .update(s.printers)
    .set({ host: '127.0.0.1', port: printers.kitchen.port })
    .where(eq(s.printers.id, kitchenPrinter!.id));
  const created = await cloud.request('POST', '/printers', {
    headers: admin,
    body: {
      name: 'Patisserie-Drucker',
      kind: 'kitchen',
      host: '127.0.0.1',
      port: printers.dessert.port,
    },
  });
  const dessertPrinter = (await created.json()) as { id: string };
  await cloud.request('PATCH', `/kitchen-stations/${stations.dessert}`, {
    headers: admin,
    body: { printerId: dessertPrinter.id },
  });

  hubTerminal = await pairTerminal(cloud, admin, { prefix: 'HL', type: 'hub' });
  cloudFetch = async (path, init = {}) =>
    cloud.app.request(`/api/v1${path}`, {
      method: init.method ?? 'GET',
      headers: { 'content-type': 'application/json', 'x-terminal-token': hubTerminal.deviceToken },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  await syncConfig(hubDb, cloudFetch);
  sync.forgetConfigVersion(scope);
  expect(await config.refresh(cloudFetch)).toBe(true);
  const last = await hubDb.transaction((tx) => sync.lastSeq(tx, scope));
  state.update({ printCursor: last });
}, 120_000);

afterAll(async () => {
  await printers.kitchen.close();
  await printers.dessert.close();
  await cloud.close();
  await hubConnection.pool.end();
});

describe('Phase 3 gate: peak hour in the kitchen (RNF-08, RF-C27)', () => {
  it('60 orders: no ticket lost, none changes on its own, each printed once', async () => {
    const admin = cloud.as(demoSession(demo, 'admin'));
    const pair = async (prefix: string, type: 'pos' | 'kds', stationId?: string) =>
      pairTerminal(cloud, admin, { prefix, type, kitchenStationId: stationId ?? null });
    const pos: SimDevice[] = [];
    for (let i = 0; i < POS_COUNT; i += 1) {
      const terminal = await pair(`L${i}`, 'pos');
      pos.push(new SimDevice(new TestDevice(scope, terminal, demo.users.waiter.id)));
    }
    await syncConfig(hubDb, cloudFetch);
    const kdsList = [
      new SimKds(
        new TestDevice(scope, await pair('LK', 'kds', stations.kitchen), demo.users.kitchen.id),
        stations.kitchen,
      ),
      new SimKds(
        new TestDevice(scope, await pair('LB', 'kds', stations.bar), demo.users.kitchen.id),
        stations.bar,
      ),
      new SimKds(
        new TestDevice(scope, await pair('LD', 'kds', stations.dessert), demo.users.kitchen.id),
        stations.dessert,
      ),
    ];
    await syncConfig(hubDb, cloudFetch);
    await config.refresh(cloudFetch);

    let queue = new PrintWorker({
      db: hubDb,
      scope,
      state,
      config: () => config.value,
      transport: tcpTransport(2_000),
    });
    const orders: SimOrder[] = [];
    const sent = new Map<string, string>(); // ticket key → station, as the waiters routed them
    const lastBatch = new Map<SimDevice, unknown[]>();
    let opened = 0;
    let restarted = false;

    const push = async (device: SimDevice, ops: unknown[]) => {
      // One terminal in ten cannot reach the hub and talks to the cloud.
      await device.push(ops, chance(0.1) ? 'cloud' : 'hub');
      lastBatch.set(device, ops);
      // Now and then a batch arrives twice (a lost answer).
      if (chance(0.05)) await device.push(ops, 'hub');
    };
    const link = async () => {
      while ((await forwardToCloud(hubDb, cloudFetch, scope)) > 0) {
        // drain
      }
      const pulled = await pullFromCloud(hubDb, cloudFetch, scope, state.value.cloudCursor);
      state.update({ cloudCursor: pulled.cursor });
    };

    for (
      let step = 0;
      step < 4000 && orders.filter((o) => o.phase === 'closed').length < ORDERS;
      step += 1
    ) {
      const now = new Date().toISOString();
      // ── The floor ───────────────────────────────────────────────────────────
      if (opened < ORDERS && (chance(0.3) || orders.every((o) => o.phase === 'closed'))) {
        const device = pick(pos)!;
        await device.pull();
        const open = device.device.open(newId(), opened + 1);
        const items = [
          testLine({ name: 'Suppe', course: 1, stationIds: [stations.kitchen] }),
          testLine({ name: 'Bier', course: 0, stationIds: [stations.bar] }),
          testLine({ name: 'Schnitzel', course: 2, quantity: 2, stationIds: [stations.kitchen] }),
          testLine({
            name: 'Tagesmenü',
            course: 2,
            stationIds: [stations.kitchen, stations.dessert],
          }),
          ...(chance(0.5)
            ? [testLine({ name: 'Tiramisu', course: 2, stationIds: [stations.dessert] })]
            : []),
        ];
        const add = device.device.op('items.add', open.orderId, { items });
        const first = items.filter((i) => i.course <= 1);
        const routed = [...new Set(first.flatMap((i) => i.stationIds))];
        const send = device.device.send(
          open.orderId,
          first.map((i) => i.itemId),
          routed,
        );
        for (const stationId of routed) sent.set(`${send.id}:${stationId}`, stationId);
        await push(device, [open, add, send]);
        orders.push({ id: open.orderId, pos: device, phase: 'course1' });
        opened += 1;
      }

      const order = pick(orders.filter((o) => o.phase !== 'closed'));
      if (order) {
        const device = order.pos;
        await device.pull();
        const state = device.fold();
        const items = itemsOf(state, order.id).filter((i) => i.prepStatus !== 'voided');
        const d = device.device;
        const course = (n: number) =>
          items.filter((i) => (n === 1 ? i.course <= 1 : i.course === 2));
        const ops: unknown[] = [];
        if (chance(0.08)) {
          // A void after sending: the kitchen sees it struck, the printer a storno slip (RN-13).
          const target = pick(
            items.filter((i) => i.prepStatus !== 'pending' && i.prepStatus !== 'served'),
          );
          if (target) {
            ops.push(
              d.op(
                'item.void',
                order.id,
                {
                  itemId: target.id,
                  quantity: 1,
                  voidedItemId: newId(),
                  reason: 'guest_changed_mind',
                  reasonText: null,
                },
                {
                  approval: {
                    approverUserId: demo.users.manager.id,
                    permissions: ['order.void_item', 'approval.grant'],
                  },
                },
              ),
            );
          }
        } else if (chance(0.05)) {
          // A course-2 dish moves to another open table of the same waiter before it is sent.
          const other = pick(
            orders.filter((o) => o.pos === device && o.id !== order.id && o.phase === 'course1'),
          );
          const target = pick(course(2).filter((i) => i.prepStatus === 'pending'));
          if (other && target && state.orders.get(other.id)?.status === 'open') {
            ops.push(
              d.op('items.transfer', order.id, { itemIds: [target.id], toOrderId: other.id }),
            );
          }
        } else if (order.phase === 'course1' || order.phase === 'course2') {
          const current = course(order.phase === 'course1' ? 1 : 2);
          const ready = current.filter((i) => i.prepStatus === 'ready');
          if (ready.length > 0)
            ops.push(d.op('items.serve', order.id, { itemIds: ready.map((i) => i.id) }));
          const waiting = current.filter((i) => i.prepStatus !== 'served' && !ready.includes(i));
          if (waiting.length === 0) {
            if (order.phase === 'course1') {
              // March the second course (RF-C09).
              const second = course(2).filter((i) => i.prepStatus === 'pending');
              if (second.length > 0) {
                const routed = [...new Set(second.flatMap((i) => i.stationIds))];
                const march = d.send(
                  order.id,
                  second.map((i) => i.id),
                  routed,
                );
                for (const stationId of routed) sent.set(`${march.id}:${stationId}`, stationId);
                ops.push(march);
              }
              order.phase = 'course2';
            } else {
              order.phase = 'paying';
            }
          }
        } else if (order.phase === 'paying') {
          const current = state.orders.get(order.id)!;
          if (items.length === 0 && current.status === 'open') {
            // Everything was voided or moved away: an empty order is voided, not closed (RN-12).
            ops.push(
              d.op(
                'order.void',
                order.id,
                { reason: 'guest_changed_mind', reasonText: null },
                {
                  approval: {
                    approverUserId: demo.users.manager.id,
                    permissions: ['order.void', 'approval.grant'],
                  },
                },
              ),
            );
          } else if (items.every((i) => i.prepStatus === 'served') && current.balanceRappen > 0) {
            ops.push(
              await d.pay(
                order.id,
                current.balanceRappen,
                chance(0.5) ? { method: 'cash', adapter: 'cash' } : {},
              ),
            );
          }
          if (current.status === 'closed' || current.status === 'voided') order.phase = 'closed';
        }
        if (ops.length > 0) await push(device, ops);
      }

      // ── The kitchen ─────────────────────────────────────────────────────────
      const kds = pick(kdsList)!;
      const { board } = await kds.refresh(now);
      const ops: unknown[] = [];
      for (const ticket of board.active.slice(0, 3)) {
        const live = ticket.items.filter((i) => i.status !== 'voided' && i.status !== 'served');
        if (live.length === 0) continue;
        const ids = live.map((i) => i.itemId);
        if (ticket.status === 'sent')
          ops.push(kds.device.kitchen('kitchen.start', ticket.orderId, kds.stationId, ids));
        else ops.push(kds.device.kitchen('kitchen.ready', ticket.orderId, kds.stationId, ids));
      }
      const recall = chance(0.03)
        ? pick(board.done.filter((t) => t.status === 'ready'))
        : undefined;
      if (recall) {
        const ids = recall.items.filter((i) => i.status === 'ready').map((i) => i.itemId);
        if (ids.length > 0)
          ops.push(kds.device.kitchen('kitchen.recall', recall.orderId, kds.stationId, ids));
      }
      if (ops.length > 0) await kds.push(ops);

      // ── The hub ─────────────────────────────────────────────────────────────
      if (step % 5 === 0) await link();
      if (step % 3 === 0) await queue.runOnce();
      if (!restarted && opened >= ORDERS / 2) {
        // The hub restarts: a new queue, and the last planned operations are planned again.
        restarted = true;
        state.update({ printCursor: Math.max(0, state.value.printCursor - 40) });
        queue = new PrintWorker({
          db: hubDb,
          scope,
          state,
          config: () => config.value,
          transport: tcpTransport(2_000),
        });
      }
    }

    // ── Flush: everything reaches everyone ────────────────────────────────────
    expect(orders.filter((o) => o.phase === 'closed')).toHaveLength(ORDERS);
    for (const device of pos) {
      const batch = lastBatch.get(device);
      if (batch) await device.push(batch, 'hub'); // one more duplicate for good measure
    }
    await link();
    await link();
    for (let i = 0; i < 3; i += 1) await queue.runOnce();
    for (const kds of kdsList) await kds.refresh(new Date().toISOString());

    // 1. No ticket lost: every send reached exactly the station it was routed to, once.
    for (const kds of kdsList) {
      const state = kds.fold();
      const own = [...state.tickets.values()].filter(
        (t) => sent.has(t.key) && t.stationId === kds.stationId,
      );
      const expected = [...sent.entries()].filter(([, stationId]) => stationId === kds.stationId);
      expect(own.map((t) => t.key).sort()).toEqual(expected.map(([key]) => key).sort());
      expect(kds.checks).toBeGreaterThan(10);
    }

    // 2. The cloud and the hub hold the same operations; the cloud's tickets are the kitchen's.
    const orderIds = orders.map((o) => o.id);
    const reference = kdsList[0]!.fold();
    const cloudTickets = await cloud.db
      .select()
      .from(s.kitchenTickets)
      .where(inArray(s.kitchenTickets.orderId, orderIds));
    const expectedTickets = [...reference.tickets.values()].filter((t) => sent.has(t.key));
    expect(cloudTickets).toHaveLength(expectedTickets.length);
    const byId = new Map(cloudTickets.map((t) => [t.id, t]));
    for (const ticket of expectedTickets) {
      expect(byId.get(ticket.id!)?.status, ticket.key).toBe(
        ticketProgress(reference, ticket).status,
      );
    }
    const cloudOrders = await cloud.db
      .select()
      .from(s.orders)
      .where(inArray(s.orders.id, orderIds));
    expect(cloudOrders).toHaveLength(ORDERS);
    expect(cloudOrders.every((o) => o.status === 'closed' || o.status === 'voided')).toBe(true);
    const hubOps = await hubDb
      .select({ id: s.syncOperations.id })
      .from(s.syncOperations)
      .where(inArray(s.syncOperations.entityId, orderIds));
    const cloudOps = await cloud.db
      .select({ id: s.syncOperations.id })
      .from(s.syncOperations)
      .where(inArray(s.syncOperations.entityId, orderIds));
    expect(hubOps.map((r) => r.id).sort()).toEqual(cloudOps.map((r) => r.id).sort());

    // 3. Each station ticket and storno slip printed exactly once, restart included.
    const jobs = await hubDb
      .select()
      .from(s.printJobs)
      .where(eq(s.printJobs.locationId, demo.locationId));
    const ours = jobs.filter(
      (j) => j.sourceOperationId && hubOps.some((o) => o.id === j.sourceOperationId),
    );
    const printedKitchen = ours.filter((j) => j.kind === 'kitchen');
    const withPrinter = expectedTickets.filter((t) => t.stationId !== stations.bar);
    // A ticket whose items were all voided before the hub planned it has nothing to print.
    const fullyVoided = withPrinter.filter((t) => ticketProgress(reference, t).status === 'voided');
    expect(printedKitchen.length).toBeLessThanOrEqual(withPrinter.length);
    expect(printedKitchen.length).toBeGreaterThanOrEqual(withPrinter.length - fullyVoided.length);
    expect(ours.every((j) => j.status === 'printed')).toBe(true);
    expect(new Set(ours.map((j) => j.jobKey)).size).toBe(ours.length);
    const kitchenPrints = printers.kitchen.jobs.filter((j) => j.lines.some((l) => l === 'KÜCHE'));
    const dessertPrints = printers.dessert.jobs.filter((j) =>
      j.lines.some((l) => l === 'PATISSERIE'),
    );
    expect(kitchenPrints.length + dessertPrints.length).toBe(
      ours.filter((j) => j.kind === 'kitchen' || j.kind === 'storno').length,
    );
    const stornos = ours.filter((j) => j.kind === 'storno');
    expect(stornos.length).toBeGreaterThan(0);
    console.log(
      `Gate: ${ORDERS} orders, ${sent.size} tickets, ${printedKitchen.length} printed, ${stornos.length} storno slips, ` +
        `${kdsList.reduce((n, k) => n + k.checks, 0)} KDS refreshes checked`,
    );
  }, 900_000);
});
