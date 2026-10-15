import { newId } from '@pos/core';
import { schema as s } from '@pos/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
 * Reports (RF-F01…RF-F08, RF-F10, RF-F13) against MySQL: a day is sold, its Z closed, and the
 * reports of that day add up to the Z to the rappen (DEC-038); a refund on the next day counts
 * there; nothing crosses organizations (RNF-12).
 */

const api = createTestApi();
let demo: DemoContext;
let scope: { organizationId: string; locationId: string };
let till: TestDevice;
let manager: Record<string, string>;

const DAY = '2024-07-01';
const NEXT = '2024-07-02';

type Json = Record<string, unknown>;
const get = async <T = Json>(path: string, headers = manager) => {
  const response = await api.request('GET', path, { headers });
  return { status: response.status, body: (await response.json()) as T, response };
};

const push = async (device: TestDevice, operations: unknown[]) => {
  const response = await api.request('POST', '/sync/push', {
    headers: device.headers,
    body: { operations },
  });
  expect(response.status).toBe(200);
  const { results } = (await response.json()) as { results: { id: string; status: string }[] };
  expect(results.filter((result) => result.status === 'rejected')).toEqual([]);
};

const onDay = (device: TestDevice, day: string) =>
  Object.assign(new TestDevice(scope, device.terminal, device.userId), { businessDate: day });

let kitchenStation: string;
let paymentA: string;
let closing: { totals: Json & { byTaxRate: Json[]; grossSalesRappen: number; tipsRappen: number } };

beforeAll(async () => {
  demo = await loadDemo(api.db);
  scope = { organizationId: demo.organizationId, locationId: demo.locationId };
  manager = api.as(demoSession(demo, 'manager'));
  const admin = api.as(demoSession(demo, 'admin'));
  const terminal = await pairTerminal(api, admin, { prefix: 'RP', type: 'pos' });
  till = new TestDevice(scope, terminal, demo.users.waiter.id);
  const [station] = await api.db
    .select({ id: s.kitchenStations.id })
    .from(s.kitchenStations)
    .where(eq(s.kitchenStations.locationId, demo.locationId));
  kitchenStation = station!.id;

  const day = onDay(till, DAY);
  const asManager = { userId: demo.users.manager.id };
  // Order A: Rösti and a beer; the beer is voided, CHF 4.50 off the order, paid by card + tip.
  const rosti = testLine({ stationIds: [kitchenStation] });
  const beer = testLine({
    name: 'Bier',
    unitPriceRappen: 700,
    taxCategoryKey: 'alcoholic_beverage',
  });
  // Operations are made in this order: the fold sorts them by their clock (HLC).
  const a = day.open(newId(), 1);
  const addA = day.op('items.add', a.orderId, { items: [rosti, beer] });
  const voidBeer = day.op(
    'item.void',
    a.orderId,
    {
      itemId: beer.itemId,
      quantity: 1,
      voidedItemId: beer.itemId,
      reason: 'entry_error',
      reasonText: null,
    },
    asManager,
  );
  const discount = day.op(
    'discount.apply',
    a.orderId,
    {
      discountId: newId(),
      itemId: null,
      kind: 'amount',
      value: 450,
      reasonCode: 'regular',
      reasonText: null,
    },
    asManager,
  );
  const sendA = day.send(a.orderId, [rosti.itemId], [kitchenStation]);
  const readyA = day.kitchen('kitchen.ready', a.orderId, kitchenStation, [rosti.itemId]);
  const serveA = day.op('items.serve', a.orderId, { itemIds: [rosti.itemId] });
  const payA = await day.pay(a.orderId, 2000, {
    tipRappen: 200,
    tipUserId: demo.users.waiter2.id,
    businessDate: DAY,
  });
  paymentA = payA.payload.paymentId as string;
  // Order B: fries paid with TWINT on the terminal.
  const b = day.open(newId(), 2);
  const fries = testLine({ name: 'Pommes' });
  const addB = day.op('items.add', b.orderId, { items: [fries] });
  const sendB = day.send(b.orderId, [fries.itemId]);
  const serveB = day.op('items.serve', b.orderId, { itemIds: [fries.itemId] });
  const payB = await day.pay(b.orderId, 2450, { method: 'twint', businessDate: DAY });
  await push(day, [
    a,
    addA,
    voidBeer,
    discount,
    sendA,
    readyA,
    serveA,
    payA,
    b,
    addB,
    sendB,
    serveB,
    payB,
  ]);

  // The Z of the day.
  const closed = await api.request('POST', '/cash/day-close', {
    headers: manager,
    body: {
      businessDate: DAY,
      reconciliations: [
        { method: 'card', terminalTotalRappen: 2200 },
        { method: 'twint', terminalTotalRappen: 2450 },
      ],
    },
  });
  expect(closed.status, JSON.stringify(await closed.clone().json())).toBe(200);
  closing = (await closed.json()) as typeof closing;

  // The next day, CHF 10 of the Rösti go back to the card, with CHF 1 of the tip.
  const next = onDay(till, NEXT);
  await push(next, [
    next.op(
      'refund.record',
      a.orderId,
      {
        refundId: newId(),
        paymentId: paymentA,
        method: 'card',
        adapter: 'external-terminal',
        amountRappen: 1000,
        tipRappen: 100,
        roundingRappen: 0,
        reason: 'Zu kalt serviert',
        externalReference: null,
        shiftId: null,
        businessDate: NEXT,
      },
      asManager,
    ),
  ]);
}, 60_000);

afterAll(async () => {
  await api.close();
});

describe('a day of reports adds up to its Z (DEC-038)', () => {
  it('sales: the total, the tips and every breakdown', async () => {
    const { status, body } = await get<Json & { sales: Json; items: Json }>(
      `/reports/sales?from=${DAY}&to=${DAY}`,
    );
    expect(status).toBe(200);
    const sales = body.sales as {
      salesRappen: number;
      tipsRappen: number;
      byMethod: { key: string; salesRappen: number }[];
      byWaiter: { key: string | null; salesRappen: number }[];
      byHour: { salesRappen: number }[];
    };
    expect(sales.salesRappen).toBe(closing.totals.grossSalesRappen);
    expect(sales.salesRappen).toBe(2000 + 2450);
    expect(sales.tipsRappen).toBe(closing.totals.tipsRappen);
    expect(sales.byMethod.map((m) => [m.key, m.salesRappen])).toEqual([
      ['card', 2000],
      ['twint', 2450],
    ]);
    expect(sales.byWaiter).toEqual([
      expect.objectContaining({ key: demo.users.waiter.id, salesRappen: 4450 }),
    ]);
    expect(sales.byHour.reduce((t, h) => t + h.salesRappen, 0)).toBe(4450);
    // The positions of the closed orders: the voided beer is not there.
    expect(body.items).toMatchObject({ salesRappen: 4450, quantity: 2 });
    expect(body.itemsDifferenceRappen).toBe(0);
  });

  it('MWST by rate is the Z by rate, tax included', async () => {
    const { body } = await get<{ byTaxRate: Json[]; taxRappen: number }>(
      `/reports/vat?from=${DAY}&to=${DAY}&granularity=day`,
    );
    expect(body.byTaxRate).toEqual(closing.totals.byTaxRate);
    expect(body.taxRappen).toBeGreaterThan(0);
  });

  it('the accounting rows and the CSV add up to the Z', async () => {
    const { body } = await get<{
      rows: { kind: string; grossRappen: number; taxRappen: number }[];
    }>(`/reports/accounting?from=${DAY}&to=${DAY}`);
    const sales = body.rows.filter((row) => row.kind === 'sale');
    expect(sales.reduce((t, row) => t + row.grossRappen, 0)).toBe(closing.totals.grossSalesRappen);
    expect(body.rows.find((row) => row.kind === 'tip')).toMatchObject({
      grossRappen: 200,
      taxRappen: 0,
    });

    const csv = await api.request('GET', `/reports/accounting.csv?from=${DAY}&to=${DAY}`, {
      headers: manager,
    });
    expect(csv.headers.get('content-type')).toContain('text/csv');
    const bytes = new Uint8Array(await csv.arrayBuffer());
    // UTF-8 with BOM, so Excel in Switzerland opens umlauts right.
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes);
    expect(text.split('\r\n')[0]).toBe(
      'business_date;kind;payment_method;vat_rate_code;vat_rate_percent;gross_chf;vat_chf;net_chf',
    );
    expect(text).toContain(`${DAY};tip;card;;;2.00;0.00;2.00`);
  });

  it('tips by person: to whom the tip was given', async () => {
    const { body } = await get<{ tipsRappen: number; byPerson: Json[] }>(
      `/reports/tips?from=${DAY}&to=${DAY}`,
    );
    expect(body.tipsRappen).toBe(closing.totals.tipsRappen);
    expect(body.byPerson).toEqual([
      expect.objectContaining({ userId: demo.users.waiter2.id, tipsRappen: 200, count: 1 }),
    ]);
  });
});

describe('a period of two days', () => {
  it('a refund counts on its own day, its tip comes off the person', async () => {
    const { body } = await get<Json & { sales: { salesRappen: number; byDay: Json[] } }>(
      `/reports/sales?from=${DAY}&to=${NEXT}`,
    );
    expect(body.sales.salesRappen).toBe(4450 - 1000);
    expect(body.sales.byDay).toEqual([
      expect.objectContaining({ key: DAY, salesRappen: 4450 }),
      expect.objectContaining({ key: NEXT, salesRappen: -1000, refundCount: 1 }),
    ]);
    // The previous period is the two days before.
    expect(body.previous).toMatchObject({ from: '2024-06-29', to: '2024-06-30' });
    const tips = await get<{ byPerson: Json[] }>(`/reports/tips?from=${DAY}&to=${NEXT}`);
    expect(tips.body.byPerson).toEqual([
      expect.objectContaining({ userId: demo.users.waiter2.id, tipsRappen: 100 }),
    ]);
    const vat = await get<{ periods: { key: string }[] }>(
      `/reports/vat?from=${DAY}&to=${NEXT}&granularity=month`,
    );
    expect(vat.body.periods.map((p) => p.key)).toEqual(['2024-07']);
  });

  it('voids, discounts and refunds by person with their reason', async () => {
    const { body } = await get<{
      voids: Json;
      discounts: Json;
      refunds: Json;
      records: { voids: Json[]; refunds: Json[] };
    }>(`/reports/adjustments?from=${DAY}&to=${NEXT}`);
    expect(body.voids).toEqual({ count: 1, rappen: 700 });
    expect(body.discounts).toEqual({ count: 1, rappen: 450 });
    expect(body.refunds).toEqual({ count: 1, rappen: 1000 });
    expect(body.records.voids[0]).toMatchObject({
      userId: demo.users.manager.id,
      reason: 'entry_error',
      productName: 'Bier',
    });
    expect(body.records.refunds[0]).toMatchObject({ reason: 'Zu kalt serviert' });
  });

  it('kitchen times by station, and the archive of receipts and closings', async () => {
    const times = await get<{ kitchen: { byStation: Json[] }; stationNames: Json }>(
      `/reports/times?from=${DAY}&to=${DAY}`,
    );
    expect(times.body.kitchen.byStation).toEqual([
      expect.objectContaining({
        stationId: kitchenStation,
        stats: expect.objectContaining({ count: 1 }),
      }),
    ]);
    expect(times.body.stationNames[kitchenStation]).toEqual(expect.any(String));

    const receipts = await get<{ receipts: Json[] }>(
      `/reports/archive/receipts?from=${DAY}&to=${NEXT}`,
    );
    expect(receipts.body.receipts).toHaveLength(2);
    expect(receipts.body.receipts[0]).toMatchObject({ businessDate: DAY, copyNumber: 0 });
    const closings = await get<{ closings: Json[] }>(
      `/reports/archive/closings?from=${DAY}&to=${NEXT}`,
    );
    expect(closings.body.closings).toEqual([
      expect.objectContaining({ businessDate: DAY, totals: closing.totals }),
    ]);
  });
});

describe('who may read reports', () => {
  it('the dashboard of today answers for a manager', async () => {
    const { status, body } = await get<Json>('/reports/dashboard');
    expect(status).toBe(200);
    expect(body).toMatchObject({
      businessDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      tables: { total: expect.any(Number) },
    });
  });

  it('a waiter is refused; a bad or too long period is refused', async () => {
    const waiter = api.as(demoSession(demo, 'waiter'));
    expect((await get(`/reports/sales?from=${DAY}&to=${DAY}`, waiter)).status).toBe(403);
    expect((await get(`/reports/sales?from=${NEXT}&to=${DAY}`)).status).toBe(422);
    expect((await get('/reports/sales?from=2023-01-01&to=2024-07-01')).status).toBe(422);
  });

  it('another organization sees none of it (RNF-12)', async () => {
    const other = await createOtherOrganization(api.db, 'Reports Other');
    const theirs = api.as(other.session);
    const { status, body } = await get<{ sales: { salesRappen: number } }>(
      `/reports/sales?from=${DAY}&to=${NEXT}`,
      theirs,
    );
    expect(status).toBe(200);
    expect(body.sales.salesRappen).toBe(0);
    const receipts = await get<{ receipts: Json[] }>(
      `/reports/archive/receipts?from=${DAY}&to=${NEXT}`,
      theirs,
    );
    expect(receipts.body.receipts).toEqual([]);
  });
});
