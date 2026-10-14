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
import { newId } from '@pos/core';
import { createDb, schema as s } from '@pos/db';
import { hubTestDatabaseUrl } from '@pos/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import type { CloudFetch } from './cloud';
import { syncConfig } from './config-sync';
import { PrintConfigCache } from './printing/config';
import { type FakePrinter, startFakePrinter } from './printing/fake-printer';
import { tcpTransport } from './printing/transport';
import { PrintWorker } from './printing/worker';
import type { HubMessage } from './realtime';
import { StateFile } from './state';
import { resetHubLog } from './test-support';

/**
 * Printing on the hub (Phase 3, DEC-031, RF-C26, RF-D18, RF-F17, RN-13): kitchen tickets at the
 * station printer, storno slips, reprints, receipts and the cash drawer at the terminal's
 * printer, each exactly once, with retries while a printer is off and the test page requested
 * from the backoffice. Real cloud and hub databases; printers simulated on TCP.
 */

const cloud = createTestApi();
const hubConnection = createDb(hubTestDatabaseUrl(), { connectionLimit: 4 });
const hubDb = hubConnection.db;
const state = new StateFile(null);
const config = new PrintConfigCache(null);
const messages: HubMessage[] = [];
let demo: DemoContext;
let scope: { organizationId: string; locationId: string };
let hubTerminal: PairedTerminal;
let pos: TestDevice;
let kds: TestDevice;
let cloudFetch: CloudFetch;
let kitchenPrinter: FakePrinter;
let receiptPrinter: FakePrinter;
let ids: {
  kitchen: string;
  bar: string;
  kitchenPrinter: string;
  receiptPrinter: string;
  table5: string;
  schnitzel: { id: string; name: string };
};
/** Shifts the hub's clock in the tests (retries, age limit). */
let clockOffset = 0;

const worker = (now?: () => Date) =>
  new PrintWorker({
    db: hubDb,
    scope,
    state,
    config: () => config.value,
    transport: tcpTransport(2_000),
    cloud: cloudFetch,
    broadcast: (message) => messages.push(message),
    now: now ?? (() => new Date(Date.now() + clockOffset)),
    waitLimitMs: 60_000,
  });

const hubApp = () =>
  createApp({
    pingDatabase: null,
    connectedClients: () => 0,
    api: createApiApp({
      db: hubDb,
      modules: 'sync',
      node: { kind: 'hub', authority: true, configVersion: () => state.value.cloudConfigVersion },
    }),
  });

async function pushToHub(device: TestDevice, operations: unknown[]) {
  const response = await hubApp().request('/api/v1/sync/push', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-terminal-token': device.terminal.deviceToken,
    },
    body: JSON.stringify({ operations }),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as { results: { status: string }[] };
}

const jobsOf = (printer: FakePrinter) => printer.jobs.map((job) => job.lines.join('\n'));

beforeAll(async () => {
  await resetHubLog(hubDb);
  demo = await loadDemo(cloud.db);
  scope = { organizationId: demo.organizationId, locationId: demo.locationId };
  const admin = cloud.as(demoSession(demo, 'admin'));
  kitchenPrinter = await startFakePrinter();
  receiptPrinter = await startFakePrinter();

  const stations = await cloud.db
    .select()
    .from(s.kitchenStations)
    .where(eq(s.kitchenStations.locationId, demo.locationId));
  const printers = await cloud.db
    .select()
    .from(s.printers)
    .where(eq(s.printers.locationId, demo.locationId));
  const [table5] = await cloud.db
    .select()
    .from(s.diningTables)
    .where(and(eq(s.diningTables.locationId, demo.locationId), eq(s.diningTables.label, '5')));
  const [schnitzel] = await cloud.db
    .select()
    .from(s.products)
    .where(
      and(
        eq(s.products.organizationId, demo.organizationId),
        eq(s.products.name, 'Wiener Schnitzel mit Pommes frites'),
      ),
    );
  ids = {
    kitchen: stations.find((st) => st.name === 'Küche')!.id,
    bar: stations.find((st) => st.name === 'Bar')!.id,
    kitchenPrinter: printers.find((p) => p.kind === 'kitchen')!.id,
    receiptPrinter: printers.find((p) => p.kind === 'receipt')!.id,
    table5: table5!.id,
    schnitzel: { id: schnitzel!.id, name: schnitzel!.name },
  };
  // The seed printers point to the simulated ones.
  await cloud.db
    .update(s.printers)
    .set({ host: '127.0.0.1', port: kitchenPrinter.port })
    .where(eq(s.printers.id, ids.kitchenPrinter));
  await cloud.db
    .update(s.printers)
    .set({ host: '127.0.0.1', port: receiptPrinter.port })
    .where(eq(s.printers.id, ids.receiptPrinter));

  hubTerminal = await pairTerminal(cloud, admin, { prefix: 'HP', type: 'hub' });
  pos = new TestDevice(
    scope,
    await pairTerminal(cloud, admin, { prefix: 'PP', receiptPrinterId: ids.receiptPrinter }),
    demo.users.waiter.id,
  );
  kds = new TestDevice(
    scope,
    await pairTerminal(cloud, admin, { prefix: 'DP', type: 'kds', kitchenStationId: ids.kitchen }),
    demo.users.kitchen.id,
  );
  cloudFetch = async (path, init = {}) =>
    cloud.app.request(`/api/v1${path}`, {
      method: init.method ?? 'GET',
      headers: { 'content-type': 'application/json', 'x-terminal-token': hubTerminal.deviceToken },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  await syncConfig(hubDb, cloudFetch);
  sync.forgetConfigVersion(scope);
  expect(await config.refresh(cloudFetch)).toBe(true);
  // Only what this file pushes: other hub tests share the database.
  const last = await hubDb.transaction((tx) => sync.lastSeq(tx, scope));
  state.update({ printCursor: last });
});

beforeEach(() => {
  clockOffset = 0;
  messages.length = 0;
});

afterAll(async () => {
  await kitchenPrinter.close();
  await receiptPrinter.close();
  await cloud.close();
  await hubConnection.pool.end();
});

/** A table order with a schnitzel (kitchen, has a printer) and a beer (bar, no printer). */
function tableOrder(number: number) {
  const open = pos.open(newId(), number, { tableId: ids.table5 });
  const schnitzel = testLine({
    productId: ids.schnitzel.id,
    name: ids.schnitzel.name,
    quantity: 2,
    note: 'Gut durch',
    stationIds: [ids.kitchen],
  });
  const beer = testLine({ name: 'Bier', course: 0, stationIds: [ids.bar] });
  const add = pos.op('items.add', open.orderId, { items: [schnitzel, beer] });
  return { open, add, schnitzel, beer, orderId: open.orderId };
}

describe('kitchen tickets on the station printer (RF-C26, RF-C25, RF-C20)', () => {
  it('prints each station ticket once, in the kitchen language, with note and allergens', async () => {
    const order = tableOrder(301);
    const send = pos.send(
      order.orderId,
      [order.schnitzel.itemId, order.beer.itemId],
      [ids.kitchen, ids.bar],
    );
    await pushToHub(pos, [order.open, order.add, send]);
    await worker().runOnce();

    expect(kitchenPrinter.jobs).toHaveLength(1);
    const [ticket] = kitchenPrinter.jobs;
    expect(ticket!.lines).toEqual(
      expect.arrayContaining([
        'KÜCHE',
        'Tisch 5',
        `2x ${ids.schnitzel.name}`,
        '   > Notiz: Gut durch',
      ]),
    );
    expect(ticket!.lines.some((line) => line.startsWith('   ! Allergene:'))).toBe(true);
    expect(ticket!.emphasized).toContain('Tisch 5');
    expect(ticket!.cuts).toBe(1);
    // The bar has no printer (it has its KDS): nothing printed for it, nothing at the counter.
    expect(receiptPrinter.jobs).toHaveLength(0);

    // The same operations again and a restarted queue: nothing prints twice.
    expect(
      (await pushToHub(pos, [order.open, order.add, send])).results.map((r) => r.status),
    ).toEqual(['duplicate', 'duplicate', 'duplicate']);
    await worker().runOnce();
    state.update({ printCursor: 0 });
    await worker().runOnce();
    expect(kitchenPrinter.jobs).toHaveLength(1);
    const jobs = await hubDb
      .select()
      .from(s.printJobs)
      .where(eq(s.printJobs.sourceOperationId, send.id));
    expect(jobs.map((j) => [j.kind, j.status, j.attempts])).toEqual([['kitchen', 'printed', 1]]);
  });

  it('a void after sending prints a storno slip; a reprint prints the ticket again (RN-13)', async () => {
    const order = tableOrder(302);
    const send = pos.send(order.orderId, [order.schnitzel.itemId], [ids.kitchen]);
    const voidOne = pos.op(
      'item.void',
      order.orderId,
      {
        itemId: order.schnitzel.itemId,
        quantity: 1,
        voidedItemId: newId(),
        reason: 'guest_changed_mind',
        reasonText: null,
      },
      { approval: { approverUserId: demo.users.manager.id, permissions: ['order.void_item'] } },
    );
    await pushToHub(pos, [order.open, order.add, send, voidOne]);
    kitchenPrinter.jobs.length = 0;
    await worker().runOnce();
    expect(jobsOf(kitchenPrinter)).toHaveLength(2);
    const [, storno] = kitchenPrinter.jobs;
    expect(storno!.lines[1]).toMatch(/^\*\*\* STORNO \d\d:\d\d \*\*\*$/);
    expect(storno!.lines.filter((l) => /^\dx /.test(l))).toEqual([`1x ${ids.schnitzel.name}`]);

    kds.sees(order.open, order.add, send, voidOne);
    const reprint = kds.op('kitchen.reprint', order.orderId, {
      sendOperationId: send.id,
      stationId: ids.kitchen,
    });
    await pushToHub(kds, [reprint]);
    await worker().runOnce();
    const last = kitchenPrinter.jobs.at(-1)!;
    expect(last.lines[1]).toMatch(/^\*\*\* NACHDRUCK/);
    // After the partial void one schnitzel is left.
    expect(last.lines).toContain(`1x ${ids.schnitzel.name}`);
  });

  it('waits for the items of a send that reached the hub before them', async () => {
    const order = tableOrder(303);
    const send = pos.send(order.orderId, [order.schnitzel.itemId], [ids.kitchen]);
    kitchenPrinter.jobs.length = 0;
    await pushToHub(pos, [order.open, send]);
    await worker().runOnce();
    expect(kitchenPrinter.jobs).toHaveLength(0);
    await pushToHub(pos, [order.add]);
    await worker().runOnce();
    expect(kitchenPrinter.jobs).toHaveLength(1);
  });

  it('an allergy noted after sending prints one notice per station; later tickets carry it (DEC-037)', async () => {
    const order = tableOrder(305);
    const send = pos.send(order.orderId, [order.schnitzel.itemId], [ids.kitchen]);
    await pushToHub(pos, [order.open, order.add, send]);
    kitchenPrinter.jobs.length = 0;
    await worker().runOnce();
    expect(kitchenPrinter.jobs).toHaveLength(1);
    expect(kitchenPrinter.jobs[0]!.lines).not.toContain('!!! ALLERGIE AM TISCH !!!');

    const guests = pos.op('order.update', order.orderId, { guestCount: 3 });
    const allergy = pos.op('order.update', order.orderId, {
      allergies: { allergens: ['tree_nuts', 'gluten'], note: 'Kiwi' },
    });
    await pushToHub(pos, [guests, allergy]);
    await worker().runOnce();
    // The guest count prints nothing; the allergy prints one notice at the kitchen printer.
    expect(kitchenPrinter.jobs).toHaveLength(2);
    const notice = kitchenPrinter.jobs[1]!.lines;
    expect(notice.join(' ')).toMatch(/\*\*\* ALLERGIE-HINWEIS \d\d:\d\d \*\*\*/);
    expect(notice).toEqual(
      expect.arrayContaining(['Tisch 5', '!!! ALLERGIE AM TISCH !!!', 'Gluten, Nüsse · Kiwi']),
    );

    // Again and from scratch: still one notice.
    await pushToHub(pos, [allergy]);
    state.update({ printCursor: 0 });
    await worker().runOnce();
    expect(kitchenPrinter.jobs).toHaveLength(2);

    // What is sent afterwards carries the warning on the ticket itself.
    const dessert = testLine({
      productId: ids.schnitzel.id,
      name: ids.schnitzel.name,
      stationIds: [ids.kitchen],
    });
    const addMore = pos.op('items.add', order.orderId, { items: [dessert] });
    const sendMore = pos.send(order.orderId, [dessert.itemId], [ids.kitchen]);
    await pushToHub(pos, [addMore, sendMore]);
    await worker().runOnce();
    expect(kitchenPrinter.jobs).toHaveLength(3);
    expect(kitchenPrinter.jobs[2]!.lines).toContain('!!! ALLERGIE AM TISCH !!!');
  });
});

describe('receipts and the cash drawer at the terminal (RF-D20, RF-D18)', () => {
  it('kicks the drawer on a cash payment and prints the receipt and a requested copy', async () => {
    const order = tableOrder(304);
    const serve = pos.op('items.serve', order.orderId, {
      itemIds: [order.schnitzel.itemId, order.beer.itemId],
    });
    const pay = await pos.pay(order.orderId, 4900, { method: 'cash', adapter: 'cash' });
    const receiptId = (pay.payload as { receipt: { receiptId: string } }).receipt.receiptId;
    const print = pos.op('receipt.print', order.orderId, { receiptId });
    const browserCopy = pos.op('receipt.reprint', order.orderId, {
      receiptId,
      copyId: newId(),
      hubPrint: false,
    });
    const hubCopy = pos.op('receipt.reprint', order.orderId, {
      receiptId,
      copyId: newId(),
      hubPrint: true,
    });
    await pushToHub(pos, [order.open, order.add, serve, pay, print, browserCopy, hubCopy]);
    await worker().runOnce();

    expect(receiptPrinter.jobs.map((j) => [j.drawerKicks, j.cuts])).toEqual([
      [1, 0],
      [0, 1],
      [0, 1],
    ]);
    const [, original, copy] = receiptPrinter.jobs;
    expect(original!.lines.join('\n')).toContain('Restaurant Demo Zürich');
    expect(original!.lines.join('\n')).not.toContain('KOPIE');
    expect(copy!.lines.join('\n')).toContain('KOPIE');
  });

  it('opens the drawer on request, but never late (a drawer that opens minutes later is wrong)', async () => {
    const reason = { reason: 'Wechselgeld' };
    const late = pos.op('drawer.open', null, reason);
    await pushToHub(pos, [late]);
    receiptPrinter.jobs.length = 0;
    await worker(() => new Date(Date.now() + 2 * 60_000)).runOnce();
    expect(receiptPrinter.jobs).toHaveLength(0);
    const [job] = await hubDb
      .select()
      .from(s.printJobs)
      .where(eq(s.printJobs.sourceOperationId, late.id));
    expect(job!.status).toBe('expired');

    const now = pos.op('drawer.open', null, reason);
    await pushToHub(pos, [now]);
    await worker().runOnce();
    expect(receiptPrinter.jobs.map((j) => j.drawerKicks)).toEqual([1]);
  });

  it('does not print kitchen tickets older than the limit (a hub that comes back late)', async () => {
    const order = tableOrder(305);
    const send = pos.send(order.orderId, [order.schnitzel.itemId], [ids.kitchen]);
    await pushToHub(pos, [order.open, order.add, send]);
    kitchenPrinter.jobs.length = 0;
    await worker(() => new Date(Date.now() + 16 * 60_000)).runOnce();
    expect(kitchenPrinter.jobs).toHaveLength(0);
    const [job] = await hubDb
      .select()
      .from(s.printJobs)
      .where(eq(s.printJobs.sourceOperationId, send.id));
    expect(job!.status).toBe('expired');
  });
});

describe('a printer that is off (DEC-031, DEC-032)', () => {
  it('retries, prints when it is back, and tells the terminals and the cloud', async () => {
    await kitchenPrinter.setOffline(true);
    const order = tableOrder(306);
    const send = pos.send(order.orderId, [order.schnitzel.itemId], [ids.kitchen]);
    await pushToHub(pos, [order.open, order.add, send]);
    kitchenPrinter.jobs.length = 0;
    const queue = worker();
    await queue.runOnce();
    const [pending] = await hubDb
      .select()
      .from(s.printJobs)
      .where(eq(s.printJobs.sourceOperationId, send.id));
    expect(pending).toMatchObject({ status: 'pending', attempts: 1 });
    expect(messages).toContainEqual(
      expect.objectContaining({ type: 'printer.status', printerId: ids.kitchenPrinter, ok: false }),
    );
    const [down] = await cloud.db
      .select()
      .from(s.printerStatus)
      .where(eq(s.printerStatus.id, ids.kitchenPrinter));
    expect(down!.lastError).toBeTruthy();

    // Not before the retry time.
    await queue.runOnce();
    expect(
      (await hubDb.select().from(s.printJobs).where(eq(s.printJobs.sourceOperationId, send.id)))[0]!
        .attempts,
    ).toBe(1);

    await kitchenPrinter.setOffline(false);
    clockOffset = 3_000;
    await queue.runOnce();
    expect(kitchenPrinter.jobs).toHaveLength(1);
    expect(messages.at(-1)).toMatchObject({ type: 'printer.status', ok: true });
    const [up] = await cloud.db
      .select()
      .from(s.printerStatus)
      .where(eq(s.printerStatus.id, ids.kitchenPrinter));
    expect(up!.lastOkAt).not.toBeNull();
  });
});

describe('test page from the backoffice (RF-F17)', () => {
  it('reaches the hub with the configuration, prints and is reported back', async () => {
    const admin = cloud.as(demoSession(demo, 'admin'));
    const requested = await cloud.request('POST', `/printers/${ids.receiptPrinter}/test`, {
      headers: admin,
    });
    expect(requested.status).toBe(202);
    sync.forgetConfigVersion(scope);
    await config.refresh(cloudFetch);
    receiptPrinter.jobs.length = 0;
    await worker().runOnce();
    await worker().runOnce();
    expect(receiptPrinter.jobs).toHaveLength(1);
    expect(receiptPrinter.jobs[0]!.lines).toContain('TESTDRUCK');
    const printers = (await (
      await cloud.request('GET', '/printers', { headers: admin })
    ).json()) as {
      id: string;
      lastTestOk: boolean | null;
    }[];
    expect(printers.find((p) => p.id === ids.receiptPrinter)!.lastTestOk).toBe(true);
  });
});
