import { formatReceiptNumber, newId, parseLocationSettings } from '@pos/core';
import { pinLookup, schema as s } from '@pos/db';
import { and, eq, inArray } from 'drizzle-orm';
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
 * Cloud synchronization (docs/SYNC.md §6, RNF-03, RNF-04, RN-16): idempotent push, ordered pull,
 * projection, conflicts for the manager and the numbering authority, against MySQL.
 */

const api = createTestApi();
let demo: DemoContext;
let admin: Record<string, string>;
let manager: Record<string, string>;
let k1: TestDevice;
let h1: TestDevice;

type Json = Record<string, unknown>;
const json = async <T = Json>(response: Response) => (await response.json()) as T;
type PushResponse = {
  results: { id: string; status: string; seq: number | null; conflicts: { code: string }[] }[];
};

const push = async (device: TestDevice, operations: unknown[]) => {
  const response = await api.request('POST', '/sync/push', {
    headers: device.headers,
    body: { operations },
  });
  expect(response.status).toBe(200);
  return json<PushResponse>(response);
};

const countRows = async (
  table: typeof s.payments | typeof s.receipts | typeof s.orders,
  orderId: string,
) =>
  (
    await api.db
      .select()
      .from(table)
      .where(eq(('orderId' in table ? table.orderId : table.id) as never, orderId))
  ).length;

const eventsOf = (aggregateId: string) =>
  api.db.select().from(s.outboxEvents).where(eq(s.outboxEvents.aggregateId, aggregateId));

beforeAll(async () => {
  demo = await loadDemo(api.db);
  admin = api.as(demoSession(demo, 'admin'));
  manager = api.as(demoSession(demo, 'manager'));
  const scope = { organizationId: demo.organizationId, locationId: demo.locationId };
  k1 = new TestDevice(
    scope,
    await pairTerminal(api, admin, { prefix: 'S1' }),
    demo.users.cashier.id,
  );
  h1 = new TestDevice(
    scope,
    await pairTerminal(api, admin, { prefix: 'S2', type: 'handheld' }),
    demo.users.waiter.id,
  );
});

afterAll(async () => {
  await api.close();
});

describe('push and projection (docs/SYNC.md §6.1)', () => {
  it('stores a whole offline service and projects the order, payment and receipt', async () => {
    const open = k1.open(newId(), 1);
    const rosti = testLine();
    const beer = testLine({
      name: 'Bier',
      unitPriceRappen: 650,
      taxCategoryKey: 'alcoholic_beverage',
    });
    const ops = [
      open,
      k1.op('items.add', open.orderId, { items: [rosti, beer] }),
      k1.op('items.send', open.orderId, { itemIds: [rosti.itemId, beer.itemId] }),
      k1.op('items.serve', open.orderId, { itemIds: [rosti.itemId, beer.itemId] }),
    ];
    ops.push(await k1.pay(open.orderId, 3100));
    const { results } = await push(k1, ops);
    expect(results.map((r) => r.status)).toEqual(Array(5).fill('applied'));
    const seqs = results.map((r) => r.seq!);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(5);

    const order = await json<Json & { items: unknown[]; payments: unknown[]; receipts: Json[] }>(
      await api.request('GET', `/orders/${open.orderId}`, { headers: manager }),
    );
    expect(order).toMatchObject({
      displayNumber: 'S1-0001',
      status: 'closed',
      paymentStatus: 'paid',
      totalRappen: 3100,
      paidRappen: 3100,
    });
    expect(order.items).toHaveLength(2);
    expect(order.payments).toHaveLength(1);
    expect(order.receipts).toHaveLength(1);
    expect(order.receipts[0]).toMatchObject({
      receiptNumber: formatReceiptNumber('S1', k1.businessDate, 1),
      copyNumber: 0,
    });

    const types = (await eventsOf(open.orderId)).map((e) => e.type).sort();
    expect(types).toEqual(
      [
        'order.closed',
        'order.created',
        'order.item_added',
        'order.item_served',
        'order.sent_to_kitchen',
      ].sort(),
    );
    // The offline prefix number is remembered for the terminal (docs/SYNC.md §8).
    const [sequence] = await api.db
      .select()
      .from(s.orderNumberSequences)
      .where(
        and(
          eq(s.orderNumberSequences.locationId, demo.locationId),
          eq(s.orderNumberSequences.prefix, 'S1'),
        ),
      );
    expect(sequence?.lastNumber).toBe(1);
  });

  it('a repeated or concurrent delivery never duplicates anything (RNF-03)', async () => {
    const open = k1.open(newId(), 2);
    const item = testLine();
    const ops = [open, k1.op('items.add', open.orderId, { items: [item] })];
    ops.push(await k1.pay(open.orderId, 2450));
    const [first, second] = await Promise.all([push(k1, ops), push(k1, ops)]);
    const statuses = [...first.results, ...second.results].map((r) => r.status);
    expect(statuses.filter((s) => s === 'applied')).toHaveLength(3);
    expect(statuses.filter((s) => s === 'duplicate')).toHaveLength(3);
    const again = await push(k1, ops);
    expect(again.results.map((r) => r.status)).toEqual(['duplicate', 'duplicate', 'duplicate']);

    expect(await countRows(s.payments, open.orderId)).toBe(1);
    expect(await countRows(s.receipts, open.orderId)).toBe(1);
    const stored = await api.db
      .select()
      .from(s.syncOperations)
      .where(
        inArray(
          s.syncOperations.id,
          ops.map((op) => op.id),
        ),
      );
    expect(stored).toHaveLength(3);
    const created = (await eventsOf(open.orderId)).filter((e) => e.type === 'order.created');
    expect(created).toHaveLength(1);
  });

  it('applies a late operation by refolding its order (out-of-order arrival)', async () => {
    const open = k1.open(newId(), 3);
    h1.sees(open);
    const item = testLine();
    const add = h1.op('items.add', open.orderId, { items: [item] });
    // The handheld syncs first: its order is not known yet.
    const early = await push(h1, [add]);
    expect(early.results[0]).toMatchObject({
      status: 'conflict',
      conflicts: [{ code: 'order_not_found' }],
    });
    // The cash desk syncs its opening: the group is refolded and the item lands.
    await push(k1, [open]);
    const [row] = await api.db
      .select()
      .from(s.syncOperations)
      .where(eq(s.syncOperations.id, add.id));
    expect(row?.status).toBe('applied');
    const order = await json<{ items: { id: string }[]; totalRappen: number }>(
      await api.request('GET', `/orders/${open.orderId}`, { headers: manager }),
    );
    expect(order.items.map((i) => i.id)).toEqual([item.itemId]);
    expect(order.totalRappen).toBe(2450);
  });

  it('rejects malformed operations and operations of a terminal of another location', async () => {
    const strange = { ...h1.open(newId(), 9), terminalId: newId() };
    const response = await push(k1, [{ id: 'nope', type: 'order.open' }, strange]);
    expect(response.results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    const stored = await api.db
      .select()
      .from(s.syncOperations)
      .where(eq(s.syncOperations.id, strange.id));
    expect(stored).toHaveLength(0);
  });

  it('a device forwards what another terminal of the location did (gossip, §11.4)', async () => {
    const theirs = h1.open(newId(), 10);
    const response = await push(k1, [theirs]);
    expect(response.results[0]!.status).toBe('applied');
    const [row] = await api.db
      .select()
      .from(s.syncOperations)
      .where(eq(s.syncOperations.id, theirs.id));
    expect(row?.terminalId).toBe(h1.terminal.id);
  });

  it('a sync push needs a paired device', async () => {
    const response = await api.request('POST', '/sync/push', {
      headers: manager,
      body: { operations: [] },
    });
    expect(response.status).toBe(403);
    const forged = await api.request('POST', '/sync/push', {
      headers: { 'x-terminal-token': 'forged' },
      body: { operations: [] },
    });
    expect(forged.status).toBe(401);
  });
});

describe('conflicts for the manager (RNF-04)', () => {
  it('keeps a double payment, flags it and lets the manager resolve it', async () => {
    const open = k1.open(newId(), 4);
    const item = testLine();
    const base = [
      open,
      k1.op('items.add', open.orderId, { items: [item] }),
      k1.op('items.serve', open.orderId, { itemIds: [item.itemId] }),
    ];
    base.push(await k1.pay(open.orderId, 2450));
    await push(k1, base);
    h1.sees(...base);
    const second = await h1.pay(open.orderId, 2450);
    const { results } = await push(h1, [second]);
    expect(results[0]!.status).toBe('conflict');
    expect(results[0]!.conflicts.map((c) => c.code).sort()).toEqual([
      'overpayment',
      'payment_on_closed_order',
    ]);
    expect(await countRows(s.payments, open.orderId)).toBe(2);

    const list = await json<{ id: string; conflicts: { code: string }[] }[]>(
      await api.request('GET', '/sync/conflicts', { headers: manager }),
    );
    expect(list.some((c) => c.id === second.id)).toBe(true);
    const detected = (await eventsOf(second.id)).filter((e) => e.type === 'sync.conflict_detected');
    expect(detected).toHaveLength(1);

    const waiterHeaders = api.as(demoSession(demo, 'waiter'));
    const forbidden = await api.request('POST', `/sync/conflicts/${second.id}/resolve`, {
      headers: waiterHeaders,
      body: { note: 'x' },
    });
    expect(forbidden.status).toBe(403);
    const resolved = await api.request('POST', `/sync/conflicts/${second.id}/resolve`, {
      headers: manager,
      body: { note: 'Doppelt bezahlt, zurückerstattet' },
    });
    expect(resolved.status).toBe(204);
    const open2 = await json<{ id: string }[]>(
      await api.request('GET', '/sync/conflicts', { headers: manager }),
    );
    expect(open2.some((c) => c.id === second.id)).toBe(false);
    const audit = await api.db
      .select()
      .from(s.auditEvents)
      .where(
        and(
          eq(s.auditEvents.action, 'sync.conflict_resolved'),
          eq(s.auditEvents.entityId, second.id),
        ),
      );
    expect(audit[0]?.reason).toBe('Doppelt bezahlt, zurückerstattet');
  });

  it('re-validates permissions: a waiter voiding a sent item without a manager is flagged', async () => {
    const open = h1.open(newId(), 5);
    const item = testLine();
    const ops = [
      open,
      h1.op('items.add', open.orderId, { items: [item] }),
      h1.op('items.send', open.orderId, { itemIds: [item.itemId] }),
      h1.op('item.void', open.orderId, {
        itemId: item.itemId,
        quantity: 1,
        voidedItemId: newId(),
        reason: 'guest_changed_mind',
        reasonText: null,
      }),
    ];
    const { results } = await push(h1, ops);
    expect(results[3]).toMatchObject({
      status: 'conflict',
      conflicts: [{ code: 'approval_invalid' }],
    });
    const audit = await api.db
      .select()
      .from(s.auditEvents)
      .where(
        and(eq(s.auditEvents.action, 'order.item_voided'), eq(s.auditEvents.entityId, item.itemId)),
      );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ userId: demo.users.waiter.id, terminalId: h1.terminal.id });
  });

  it('stores a repeated offline number with a suffix instead of failing (RN-16)', async () => {
    const first = k1.open(newId(), 50);
    const again = k1.open(newId(), 50); // a wiped device counting again from the same number
    const { results } = await push(k1, [first, again]);
    expect(results[0]!.status).toBe('applied');
    expect(results[1]).toMatchObject({
      status: 'conflict',
      conflicts: [{ code: 'duplicate_number' }],
    });
    const numbers = await api.db
      .select({ display: s.orders.displayNumber })
      .from(s.orders)
      .where(inArray(s.orders.id, [first.orderId, again.orderId]));
    expect(numbers.map((n) => n.display).sort()).toEqual(['S1-0050', 'S1-0050/2']);
  });

  it('clamps a device clock running ahead and flags it (docs/SYNC.md §3)', async () => {
    const op = k1.open(newId(), 60);
    const ahead = { ...op, hlc: `${String(Date.now() + 3_600_000).padStart(13, '0')}.0000` };
    const { results } = await push(k1, [ahead]);
    expect(results[0]).toMatchObject({ status: 'conflict', conflicts: [{ code: 'clock_skew' }] });
    const [row] = await api.db
      .select()
      .from(s.syncOperations)
      .where(eq(s.syncOperations.id, op.id));
    expect(Number(row!.hlc.split('.')[0])).toBeLessThanOrEqual(Date.now());
  });
});

describe('pull (docs/SYNC.md §6.2)', () => {
  it('returns the location operations after a cursor, in seq order, page by page', async () => {
    const all = await json<{
      operations: { seq: number; operation: { id: string } }[];
      cursor: number;
      configVersion: string;
    }>(await api.request('GET', '/sync/pull?after=0', { headers: h1.headers }));
    expect(all.operations.length).toBeGreaterThan(5);
    const seqs = all.operations.map((o) => o.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(all.cursor).toBe(seqs.at(-1));
    expect(all.configVersion).toMatch(/^[0-9a-f]{16}$/);

    const page = await json<{ operations: { seq: number }[]; cursor: number; hasMore: boolean }>(
      await api.request('GET', `/sync/pull?after=${seqs[1]}&limit=2`, { headers: h1.headers }),
    );
    expect(page.operations.map((o) => o.seq)).toEqual(seqs.slice(2, 4));
    expect(page.hasMore).toBe(true);
  });

  it('another organization sees nothing of this location (RNF-12)', async () => {
    const other = await createOtherOrganization(api.db, 'Sync Other Gastro');
    const otherAdmin = api.as(other.session);
    const terminal = await pairTerminal(api, otherAdmin, { prefix: 'O1' });
    const page = await json<{ operations: unknown[] }>(
      await api.request('GET', '/sync/pull?after=0', {
        headers: { 'x-terminal-token': terminal.deviceToken },
      }),
    );
    expect(page.operations).toHaveLength(0);
    const [someOrder] = await api.db
      .select({ id: s.orders.id })
      .from(s.orders)
      .where(eq(s.orders.locationId, demo.locationId))
      .limit(1);
    const response = await api.request('GET', `/orders/${someOrder!.id}`, { headers: otherAdmin });
    expect(response.status).toBe(404);
  });
});

describe('numbering authority (RN-16, docs/SYNC.md §6.3)', () => {
  it('hands out consecutive numbers, the same one for a repeated request', async () => {
    const a = newId();
    const b = newId();
    const ask = (orderId: string) =>
      api.request('POST', '/sync/order-numbers', { headers: k1.headers, body: { orderId } });
    const first = await json<{ number: number; display: string }>(await ask(a));
    const repeat = await json<{ number: number }>(await ask(a));
    const second = await json<{ number: number; display: string }>(await ask(b));
    expect(repeat.number).toBe(first.number);
    expect(second.number).toBe(first.number + 1);
    expect(second.display).toBe(String(second.number).padStart(4, '0'));
  });

  it('the cloud refuses to number when the location has a hub', async () => {
    const [location] = await api.db
      .select()
      .from(s.locations)
      .where(eq(s.locations.id, demo.locationId));
    const settings = parseLocationSettings(location!.settings);
    await api.db
      .update(s.locations)
      .set({ settings: { ...settings, sync: { hubUrls: ['https://hub.test'] } } as never })
      .where(eq(s.locations.id, demo.locationId));
    try {
      const response = await api.request('POST', '/sync/order-numbers', {
        headers: k1.headers,
        body: { orderId: newId() },
      });
      expect(response.status).toBe(409);
    } finally {
      await api.db
        .update(s.locations)
        .set({ settings: settings as never })
        .where(eq(s.locations.id, demo.locationId));
    }
  });
});

describe('bootstrap and credentials for offline work (docs/SYNC.md §6.4, §7)', () => {
  it('delivers catalog, tax data, floor, users and counters', async () => {
    const response = await api.request('GET', '/pos/bootstrap', { headers: k1.headers });
    expect(response.status).toBe(200);
    const body = await json<{
      terminal: { orderNumberPrefix: string };
      catalog: { products: unknown[] };
      tax: { rates: { code: string; rateBp: number }[]; rules: unknown[] };
      tables: unknown[];
      users: unknown[];
      counters: { lastOrderNumber: number; lastReceipt: number };
      location: { vatUid: string | null };
    }>(response);
    expect(body.terminal.orderNumberPrefix).toBe('S1');
    expect(body.catalog.products.length).toBeGreaterThan(20);
    expect(body.tax.rates.map((r) => r.rateBp)).toEqual(expect.arrayContaining([810, 260, 380]));
    expect(body.tax.rules.length).toBeGreaterThan(5);
    expect(body.tables.length).toBe(12);
    expect(body.users.length).toBeGreaterThan(3);
    expect(body.counters.lastOrderNumber).toBeGreaterThanOrEqual(60);
    expect(body.counters.lastReceipt).toBeGreaterThanOrEqual(1);
  });

  it('the configuration version changes with a backoffice change (RF-F23)', async () => {
    const version = async () => {
      forgetConfigVersion();
      return (
        await json<{ configVersion: string }>(
          await api.request('GET', '/sync/pull?after=999999999', { headers: k1.headers }),
        )
      ).configVersion;
    };
    const before = await version();
    const [area] = await api.db
      .select()
      .from(s.areas)
      .where(eq(s.areas.locationId, demo.locationId))
      .limit(1);
    await api.request('PATCH', `/areas/${area!.id}`, {
      headers: admin,
      body: { name: `${area!.name}*` },
    });
    expect(await version()).not.toBe(before);
    await api.request('PATCH', `/areas/${area!.id}`, {
      headers: admin,
      body: { name: area!.name },
    });
  });

  it('offline credentials carry a 4-bit bucket, never the full lookup (DEC-023)', async () => {
    const response = await api.request('GET', '/terminals/offline-credentials', {
      headers: k1.headers,
    });
    const body = await json<{ pinKey: string; users: { id: string; pinBucket: number }[] }>(
      response,
    );
    const waiter = body.users.find((u) => u.id === demo.users.waiter.id)!;
    expect(waiter.pinBucket).toBe(Number.parseInt(pinLookup(body.pinKey, '4001').charAt(0), 16));
    expect(JSON.stringify(body)).not.toContain(pinLookup(body.pinKey, '4001'));
  });
});
