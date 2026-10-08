import { createApiApp } from '@pos/api';
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
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createApp } from './app';
import type { CloudFetch } from './cloud';
import { syncConfig } from './config-sync';
import { forwardToCloud, pullFromCloud, pushPresence } from './forwarder';
import { startCloudLink } from './node';
import type { HubMessage } from './realtime';
import { startHub } from './server';
import { StateFile } from './state';
import { resetHubLog } from './test-support';

/**
 * The LAN hub (docs/SYNC.md §11, RNF-05): it authenticates terminals offline, stores their
 * operations, numbers orders and forwards everything to the cloud exactly once. Operations
 * that reached the cloud directly come back to the hub. Two real databases.
 */

const cloud = createTestApi();
const hubConnection = createDb(hubTestDatabaseUrl(), { connectionLimit: 4 });
const hubDb = hubConnection.db;
const state = new StateFile(null);
let demo: DemoContext;
let hubTerminal: PairedTerminal;
let device: TestDevice;
let cloudFetch: CloudFetch;
let scope: { organizationId: string; locationId: string };

const hubApi = (authority = true) =>
  createApiApp({
    db: hubDb,
    modules: 'sync',
    node: { kind: 'hub', authority, configVersion: () => state.value.cloudConfigVersion },
  });
let pushes = 0;
const hubApp = createApp({
  pingDatabase: null,
  connectedClients: () => 0,
  api: hubApi(),
  onPushed: () => {
    pushes += 1;
  },
});

const hubRequest = (path: string, init: { method?: string; body?: unknown; token?: string } = {}) =>
  hubApp.request(`/api/v1${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      'x-terminal-token': init.token ?? device.terminal.deviceToken,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

const pushTo = async (target: 'hub' | 'cloud', operations: unknown[]) => {
  const response =
    target === 'hub'
      ? await hubRequest('/sync/push', { method: 'POST', body: { operations } })
      : await cloud.request('POST', '/sync/push', {
          headers: device.headers,
          body: { operations },
        });
  expect(response.status).toBe(200);
  return (await response.json()) as { results: { status: string }[] };
};

beforeAll(async () => {
  await resetHubLog(hubDb);
  demo = await loadDemo(cloud.db);
  scope = { organizationId: demo.organizationId, locationId: demo.locationId };
  const admin = cloud.as(demoSession(demo, 'admin'));
  hubTerminal = await pairTerminal(cloud, admin, { prefix: 'HB', type: 'hub' });
  device = new TestDevice(
    scope,
    await pairTerminal(cloud, admin, { prefix: 'P7' }),
    demo.users.cashier.id,
  );
  cloudFetch = async (path, init = {}) =>
    cloud.app.request(`/api/v1${path}`, {
      method: init.method ?? 'GET',
      headers: { 'content-type': 'application/json', 'x-terminal-token': hubTerminal.deviceToken },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  await syncConfig(hubDb, cloudFetch);
});

afterAll(async () => {
  await cloud.close();
  await hubConnection.pool.end();
});

describe('hub configuration (docs/SYNC.md §11.2)', () => {
  it('copies the location and its terminals, so it authenticates them offline', async () => {
    const terminals = await hubDb
      .select()
      .from(s.terminals)
      .where(eq(s.terminals.locationId, demo.locationId));
    expect(terminals.map((t) => t.orderNumberPrefix)).toEqual(
      expect.arrayContaining(['K1', 'HB', 'P7']),
    );
    const forged = await hubRequest('/sync/pull?after=0', { token: 'forged' });
    expect(forged.status).toBe(401);
  });

  it('only a hub may read the hub configuration', async () => {
    const response = await cloud.request('GET', '/sync/hub-config', { headers: device.headers });
    expect(response.status).toBe(403);
  });
});

describe('terminal → hub → cloud (RNF-03, RNF-05)', () => {
  const open = () => device.open(newId(), 1);
  let ops: Awaited<ReturnType<typeof flow>>;

  async function flow() {
    const opening = open();
    const item = testLine();
    const list: Record<string, unknown>[] = [
      opening,
      device.op('items.add', opening.orderId, { items: [item] }),
      device.op('items.serve', opening.orderId, { itemIds: [item.itemId] }),
    ];
    list.push(await device.pay(opening.orderId, 2450));
    return { orderId: opening.orderId, list };
  }

  it('stores pushes on the hub and announces them; the cloud has nothing yet', async () => {
    ops = await flow();
    const { results } = await pushTo('hub', ops.list);
    expect(results.map((r) => r.status)).toEqual(['applied', 'applied', 'applied', 'applied']);
    expect(pushes).toBe(1);
    const pulled = (await (await hubRequest('/sync/pull?after=0')).json()) as {
      operations: { cloudAcked: boolean }[];
    };
    expect(pulled.operations).toHaveLength(4);
    expect(pulled.operations.every((o) => !o.cloudAcked)).toBe(true);
    const inCloud = await cloud.db.select().from(s.orders).where(eq(s.orders.id, ops.orderId));
    expect(inCloud).toHaveLength(0);
  });

  it('forwards to the cloud exactly once, with the original ids', async () => {
    expect(await forwardToCloud(hubDb, cloudFetch, scope)).toBe(4);
    expect(await forwardToCloud(hubDb, cloudFetch, scope)).toBe(0);
    const [order] = await cloud.db.select().from(s.orders).where(eq(s.orders.id, ops.orderId));
    expect(order).toMatchObject({ status: 'closed', paymentStatus: 'paid', totalRappen: 2450 });
    const pulled = (await (await hubRequest('/sync/pull?after=0')).json()) as {
      operations: { cloudAcked: boolean }[];
    };
    expect(pulled.operations.every((o) => o.cloudAcked)).toBe(true);
  });

  it('the same operations sent directly to the cloud are duplicates (hub died before acking)', async () => {
    const { results } = await pushTo('cloud', ops.list);
    expect(results.map((r) => r.status)).toEqual([
      'duplicate',
      'duplicate',
      'duplicate',
      'duplicate',
    ]);
    const payments = await cloud.db
      .select()
      .from(s.payments)
      .where(eq(s.payments.orderId, ops.orderId));
    expect(payments).toHaveLength(1);
  });

  it('brings back operations that reached the cloud directly (hub was down)', async () => {
    const direct = await flow();
    await pushTo('cloud', direct.list);
    const before = state.value.cloudCursor;
    const pulled = await pullFromCloud(hubDb, cloudFetch, scope, before);
    expect(pulled.inserted).toBeGreaterThanOrEqual(4);
    expect(pulled.configVersion).toMatch(/^[0-9a-f]{16}$/);
    state.update({ cloudCursor: pulled.cursor, cloudConfigVersion: pulled.configVersion });
    const stored = await hubDb
      .select({ id: s.syncOperations.id, acked: s.syncOperations.cloudAckedAt })
      .from(s.syncOperations)
      .where(
        inArray(
          s.syncOperations.id,
          direct.list.map((op) => op.id as string),
        ),
      );
    expect(stored).toHaveLength(4);
    expect(stored.every((row) => row.acked !== null)).toBe(true);
    // Pulling again brings nothing new.
    expect((await pullFromCloud(hubDb, cloudFetch, scope, pulled.cursor)).inserted).toBe(0);
    // Terminals on the hub get the cloud's configuration version, not the hub's.
    const page = (await (await hubRequest('/sync/pull?after=999999')).json()) as {
      configVersion: string;
    };
    expect(page.configVersion).toBe(pulled.configVersion);
  });
});

describe('numbering on the hub (RN-16, DEC-022)', () => {
  it('the authority hub hands out consecutive numbers, the same one for a repeated order', async () => {
    const ask = async (app: { request: typeof hubApp.request }, orderId: string) =>
      app.request('/api/v1/sync/order-numbers', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-terminal-token': device.terminal.deviceToken,
        },
        body: JSON.stringify({ orderId }),
      });
    const a = newId();
    const first = (await (await ask(hubApp, a)).json()) as { number: number };
    const again = (await (await ask(hubApp, a)).json()) as { number: number };
    const second = (await (await ask(hubApp, newId())).json()) as { number: number };
    expect(again.number).toBe(first.number);
    expect(second.number).toBe(first.number + 1);

    const standby = createApp({
      pingDatabase: null,
      connectedClients: () => 0,
      api: hubApi(false),
    });
    expect((await ask(standby, newId())).status).toBe(409);
  });
});

describe('real-time hints over WebSocket (RNF-07)', () => {
  it('an authenticated terminal hears about new operations; a forged one is closed', async () => {
    const hub = await startHub({
      port: 0,
      hostname: '127.0.0.1',
      pingDatabase: null,
      api: hubApi(),
      realtime: {
        authority: true,
        authenticate: async (token) => token === device.terminal.deviceToken,
      },
    });
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${hub.port}/ws`);
      const messages: HubMessage[] = [];
      const applied = new Promise<void>((resolve, reject) => {
        ws.on('message', (data) => {
          const message = JSON.parse(data.toString()) as HubMessage;
          messages.push(message);
          if (message.type === 'hub.hello') {
            ws.send(JSON.stringify({ type: 'hello', token: device.terminal.deviceToken }));
            // Give the hub a moment to authenticate, then push.
            setTimeout(async () => {
              const next = open2();
              await fetch(`http://127.0.0.1:${hub.port}/api/v1/sync/push`, {
                method: 'POST',
                headers: {
                  'content-type': 'application/json',
                  'x-terminal-token': device.terminal.deviceToken,
                },
                body: JSON.stringify({ operations: [next] }),
              });
            }, 200);
          }
          if (message.type === 'sync.applied') resolve();
        });
        ws.on('error', reject);
      });
      await applied;
      expect(messages[0]).toMatchObject({ type: 'hub.hello', protocolVersion: 2, authority: true });
      ws.close();

      const forged = new WebSocket(`ws://127.0.0.1:${hub.port}/ws`);
      const closed = await new Promise<number>((resolve) => {
        forged.on('message', (data) => {
          if ((JSON.parse(data.toString()) as HubMessage).type === 'hub.hello') {
            forged.send(JSON.stringify({ type: 'hello', token: 'forged' }));
          }
        });
        forged.on('close', (code) => resolve(code));
      });
      expect(closed).toBe(4401);

      // The cross-origin preflight of the POS (and Chrome's Private Network Access) is answered.
      const preflight = await fetch(`http://127.0.0.1:${hub.port}/api/v1/sync/push`, {
        method: 'OPTIONS',
        headers: {
          origin: 'https://pos.example.ch',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type,x-terminal-token',
          'access-control-request-private-network': 'true',
        },
      });
      expect(preflight.headers.get('access-control-allow-private-network')).toBe('true');
      expect(preflight.headers.get('access-control-allow-headers')).toContain('x-terminal-token');
      // A kitchen display says who is there with its pull (DEC-033).
      const kdsPreflight = await fetch(`http://127.0.0.1:${hub.port}/api/v1/sync/pull`, {
        method: 'OPTIONS',
        headers: {
          origin: 'https://pos.example.ch',
          'access-control-request-method': 'GET',
          'access-control-request-headers': 'x-terminal-token,x-presence,x-presence-user',
        },
      });
      expect(kdsPreflight.headers.get('access-control-allow-headers')).toContain('x-presence');
    } finally {
      await hub.close();
    }
  });
});

describe('who is at the kitchen displays (DEC-033)', () => {
  it('a display on the LAN reaches the cloud, and one on the cloud reaches the hub', async () => {
    const admin = cloud.as(demoSession(demo, 'admin'));
    const [bar] = await cloud.db
      .select({ id: s.kitchenStations.id })
      .from(s.kitchenStations)
      .where(eq(s.kitchenStations.name, 'Bar'));
    const onLan = await pairTerminal(cloud, admin, {
      prefix: 'KH1',
      type: 'kds',
      kitchenStationId: bar!.id,
    });
    const onWan = await pairTerminal(cloud, admin, {
      prefix: 'KH2',
      type: 'kds',
      kitchenStationId: bar!.id,
    });
    await syncConfig(hubDb, cloudFetch);

    const unlocked = await hubApp.request('/api/v1/sync/pull?after=0&limit=1', {
      headers: {
        'x-terminal-token': onLan.deviceToken,
        'x-presence': 'unlocked',
        'x-presence-user': demo.users.kitchen.id,
      },
    });
    expect(unlocked.status).toBe(200);
    const wan = await cloud.request('GET', '/sync/pull?after=0&limit=1', {
      headers: { 'x-terminal-token': onWan.deviceToken, 'x-presence': 'locked' },
    });
    expect(wan.status).toBe(200);

    expect(await pushPresence(hubDb, cloudFetch, scope)).toBeGreaterThanOrEqual(1);
    await pullFromCloud(hubDb, cloudFetch, scope, state.value.cloudCursor);

    type Presence = { presence: { terminalId: string; unlocked: boolean }[] };
    const viaHub = (await (await hubRequest('/sync/pull?after=0&limit=1')).json()) as Presence;
    const viaCloud = (await (
      await cloud.request('GET', '/sync/pull?after=0&limit=1', { headers: device.headers })
    ).json()) as Presence;
    for (const seen of [viaHub, viaCloud]) {
      expect(seen.presence).toContainEqual(
        expect.objectContaining({ terminalId: onLan.id, unlocked: true }),
      );
      expect(seen.presence).toContainEqual(
        expect.objectContaining({ terminalId: onWan.id, unlocked: false }),
      );
    }
  });
});

describe('a hub deactivated in the backoffice (DEC-035)', () => {
  it('stops its link with the cloud once and says so', async () => {
    const admin = cloud.as(demoSession(demo, 'admin'));
    const standby = await pairTerminal(cloud, admin, { prefix: 'HR', type: 'hub' });
    const deactivated = await cloud.request('PATCH', `/terminals/${standby.id}`, {
      headers: admin,
      body: { isActive: false },
    });
    expect(deactivated.status).toBe(200);

    let revoked = 0;
    const link = startCloudLink({
      db: hubDb,
      cloud: async (path, init = {}) =>
        cloud.app.request(`/api/v1${path}`, {
          method: init.method ?? 'GET',
          headers: { 'content-type': 'application/json', 'x-terminal-token': standby.deviceToken },
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
        }),
      scope,
      state: new StateFile(null),
      broadcast: () => undefined,
      intervalMs: 60_000,
      onRevoked: () => {
        revoked += 1;
      },
    });
    try {
      await link.runOnce();
      await expect.poll(() => revoked).toBe(1);
      // Another cycle does not report it again: the link is stopped.
      await link.runOnce();
      expect(revoked).toBe(1);
      expect(link.isOnline()).toBe(false);
    } finally {
      link.stop();
    }
  });
});

function open2() {
  return device.open(newId(), 99);
}
