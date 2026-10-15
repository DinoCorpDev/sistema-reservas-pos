import type { BootstrapDto, OfflineCredentials, PulledOperation, PushResult } from '@pos/api';
import type { PresenceEntry } from '@pos/core';
import { deviceApp, isPhone } from './app';
import { observeHlc, recordServerTime } from './clock';
import {
  deviceDb,
  getMeta,
  type OperationRow,
  resetDeviceData,
  setMeta,
  unconfirmedCount,
} from './db';
import { ingest, isKnown, prune, refold } from './engine';
import { CLOUD, callNode, NodeError } from './http';
import { getPos, usePos } from './store';

/**
 * Synchronization loop of the terminal (docs/SYNC.md §1, §6, §11.4):
 * 1. a heartbeat picks the highest node it reaches: the location hubs in order, then the cloud;
 * 2. operations not confirmed by that node are pushed (the server dedupes by id);
 * 3. new operations of the location are pulled after this node's cursor;
 * 4. a new configuration version brings a fresh bootstrap and credentials (RF-F23).
 * Without any node the POS keeps working on its own (level 1).
 *
 * A kitchen display says on every pull whether someone is logged in on it, and every pull brings
 * who is at the displays, so the POS can send around an unattended station (DEC-033). That is why
 * the KDS keeps its pace even in the background.
 *
 * When the cloud no longer accepts the device token (deactivated or unpaired in the backoffice,
 * RF-A12), the device stops: nothing works until it is paired again (DEC-035). A hub may not know
 * a freshly paired device for a few seconds, so its refusal only sends the device to the cloud.
 */

const HEARTBEAT_MS = 5_000;
const ACTIVE_INTERVAL_MS = 2_000;
const HIDDEN_INTERVAL_MS = 30_000;
const PING_TIMEOUT_MS = 2_000;
const PUSH_BATCH = 200;
/**
 * A hub that refused the device token is skipped until the next heartbeat, while the cloud
 * decides; a hub that just lags behind a new pairing knows the device a few seconds later.
 */
const REFUSED_HUB_MS = HEARTBEAT_MS;

let started = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;
let node: string | null = null;
let lastHeartbeat = 0;
const refusedHubs = new Map<string, number>();

const ackKey = (target: string) => (target === CLOUD ? 'cloud' : target);

/** Nodes in order of preference: the LAN hubs of the location, then the cloud. */
function candidates(): string[] {
  const now = Date.now();
  const hubs = (getPos().bootstrap?.location.settings.sync.hubUrls ?? []).filter(
    (hub) => (refusedHubs.get(hub) ?? 0) <= now,
  );
  return [...hubs, CLOUD];
}

/** The cloud refused the device token: the device was deactivated or unpaired (DEC-035). */
async function markRevoked(): Promise<void> {
  // A waiter's own phone keeps nothing of the shift once the cloud has all of it (DEC-036).
  if (isPhone(getPos().device) && (await unconfirmedCount()) === 0) {
    usePos.setState({ device: null, user: null });
    await resetDeviceData();
    window.location.reload();
    return;
  }
  await setMeta('revoked', { at: new Date().toISOString() });
  node = null;
  watchHub(null, '');
  // The person on it is signed out; the screens show the pairing form instead.
  usePos.setState({ revoked: true, user: null, presence: null });
  setSync({ level: 'standalone', node: null });
}

async function heartbeat(): Promise<string | null> {
  for (const candidate of candidates()) {
    const sentAt = Date.now();
    try {
      const pong = await callNode<{ serverTime: string }>(candidate, '/sync/ping', {
        timeoutMs: PING_TIMEOUT_MS,
      });
      await recordServerTime(pong.serverTime, sentAt, Date.now());
      return candidate;
    } catch {
      // Next candidate; a hanging WAN only costs the timeout.
    }
  }
  return null;
}

function setSync(patch: Partial<ReturnType<typeof getPos>['sync']>): void {
  usePos.setState((state) => ({ sync: { ...state.sync, ...patch } }));
}

async function updateCounts(): Promise<void> {
  const deviceId = getPos().device?.terminalId;
  const rows = await deviceDb().ops.where('cloudAcked').equals(0).toArray();
  setSync({
    pending: rows.filter((r) => r.own === 1 && r.rejected === 0 && r.op.terminalId === deviceId)
      .length,
    rejected: rows.filter((r) => r.rejected === 1).length,
  });
}

/** Pushes what this node has not confirmed yet, oldest first (every device gossips, §11.4). */
async function push(target: string, deviceToken: string): Promise<void> {
  const key = ackKey(target);
  const unconfirmed = (await deviceDb().ops.where('cloudAcked').equals(0).toArray())
    .filter((row) => row.rejected === 0 && !row.ackedBy.includes(key))
    .sort((a, b) => (a.hlc < b.hlc ? -1 : a.hlc > b.hlc ? 1 : a.id < b.id ? -1 : 1));
  for (let start = 0; start < unconfirmed.length; start += PUSH_BATCH) {
    const batch = unconfirmed.slice(start, start + PUSH_BATCH);
    const { results } = await callNode<{ results: PushResult[] }>(target, '/sync/push', {
      method: 'POST',
      deviceToken,
      body: { operations: batch.map((row) => row.op) },
      timeoutMs: 15_000,
    });
    const updated = batch.map((row, index): OperationRow => {
      const result = results[index];
      if (!result) return row;
      if (result.status === 'rejected') return { ...row, rejected: 1 };
      return {
        ...row,
        ackedBy: [...new Set([...row.ackedBy, key])],
        cloudAcked: target === CLOUD ? 1 : row.cloudAcked,
        conflicts: result.conflicts.map(({ code, entityId }) => ({ code, entityId })),
      };
    });
    await deviceDb().ops.bulkPut(updated);
  }
}

/**
 * Every device tells whether someone unlocked it with their PIN: kitchen displays for the routing
 * (DEC-033), every device so a person is signed in on one device at a time (DEC-040). A kitchen
 * display that chose its station at sign-in says which one (DEC-042).
 */
function presenceHeaders(): Record<string, string> {
  const { user, kitchenStationId } = getPos();
  if (!user) return { 'x-presence': 'locked' };
  return {
    'x-presence': 'unlocked',
    'x-presence-user': user.id,
    ...(kitchenStationId ? { 'x-presence-station': kitchenStationId } : {}),
  };
}

/** Pulls the location's operations after this node's cursor; returns its config version. */
async function pull(target: string, deviceToken: string): Promise<string | null> {
  const cursors = (await getMeta('cursors')) ?? {};
  let after = cursors[target] ?? 0;
  let configVersion: string | null = null;
  const deviceId = getPos().device?.terminalId;
  let clockChanged = false;
  for (let page = 0; page < 50; page += 1) {
    const sentAt = Date.now();
    const response = await callNode<{
      operations: PulledOperation[];
      cursor: number;
      hasMore: boolean;
      configVersion: string;
      serverTime: string;
      presence?: PresenceEntry[];
    }>(target, `/sync/pull?after=${after}&limit=500`, {
      deviceToken,
      timeoutMs: 15_000,
      headers: page === 0 ? presenceHeaders() : undefined,
    });
    configVersion = response.configVersion;
    if (page === 0 && response.presence) {
      // On the device clock: the middle of the request is about when the server answered.
      const receivedAt = Date.now();
      usePos.setState({
        presence: {
          entries: response.presence,
          serverTime: response.serverTime,
          receivedAt: Math.round((sentAt + receivedAt) / 2),
        },
      });
    }
    const key = ackKey(target);
    const rows: OperationRow[] = [];
    for (const pulled of response.operations) {
      const op = pulled.operation;
      const existing = await deviceDb().ops.get(op.id);
      // The server may have clamped a clock running ahead (§3): its version wins.
      if (existing && existing.hlc !== op.hlc) clockChanged = true;
      rows.push({
        id: op.id,
        hlc: op.hlc,
        op,
        own: existing?.own ?? (op.terminalId === deviceId ? 1 : 0),
        cloudAcked: pulled.cloudAcked || existing?.cloudAcked === 1 ? 1 : 0,
        ackedBy: [...new Set([...(existing?.ackedBy ?? []), key])],
        conflicts: pulled.conflicts.map(({ code, entityId }) => ({ code, entityId })),
        rejected: 0,
      });
    }
    await observeHlc(rows.map((row) => row.hlc));
    const fresh = rows.filter((row) => !isKnown(row.id));
    await deviceDb().ops.bulkPut(rows.filter((row) => isKnown(row.id)));
    await ingest(fresh);
    after = response.cursor;
    await setMeta('cursors', { ...cursors, [target]: after });
    if (!response.hasMore) break;
  }
  if (clockChanged) await refold();
  return configVersion;
}

/**
 * Fresh configuration from the cloud (the hub keeps no catalog): bootstrap and offline
 * credentials. Counters only ever grow, so a number is never reused (RN-16).
 */
export async function refreshConfiguration(deviceToken: string): Promise<void> {
  const [bootstrap, credentials] = await Promise.all([
    callNode<BootstrapDto>(CLOUD, '/pos/bootstrap', { deviceToken, timeoutMs: 20_000 }),
    callNode<OfflineCredentials>(CLOUD, '/terminals/offline-credentials', {
      deviceToken,
      timeoutMs: 10_000,
    }),
  ]);
  await setMeta('bootstrap', bootstrap);
  await setMeta('credentials', { ...credentials, fetchedAt: new Date().toISOString() });
  const counters = await getMeta('counters');
  const server = bootstrap.counters;
  if (!counters || counters.businessDate !== server.businessDate) {
    await setMeta('counters', {
      businessDate: server.businessDate,
      order: server.lastOrderNumber,
      receipt: server.lastReceipt,
    });
  } else {
    await setMeta('counters', {
      businessDate: counters.businessDate,
      order: Math.max(counters.order, server.lastOrderNumber),
      receipt: Math.max(counters.receipt, server.lastReceipt),
    });
  }
  usePos.setState({ bootstrap, credentials });
  // Settings and permissions are part of the fold context.
  await refold();
}

async function runOnce(): Promise<void> {
  const { device, bootstrap, revoked } = getPos();
  if (!device || revoked) return;
  if (node === null || Date.now() - lastHeartbeat > HEARTBEAT_MS) {
    node = await heartbeat();
    lastHeartbeat = Date.now();
  }
  if (node === null) {
    watchHub(null, device.deviceToken);
    setSync({ level: 'standalone', node: null });
    // Alone, nobody knows who is at the displays now: nothing is guessed (DEC-033).
    usePos.setState({ presence: null });
    await updateCounts();
    return;
  }
  watchHub(node, device.deviceToken);
  try {
    await push(node, device.deviceToken);
    const version = await pull(node, device.deviceToken);
    // A hub relays the cloud's version ('' while it does not know it yet); the new
    // configuration always comes from the cloud, when it is reachable (RF-F23).
    if (version && version !== bootstrap?.configVersion) {
      await refreshConfiguration(device.deviceToken).catch(() => undefined);
    }
    setSync({
      level: node === CLOUD ? 'cloud' : 'hub',
      node,
      lastSyncAt: new Date().toISOString(),
    });
    await prune();
  } catch (error) {
    if (error instanceof NodeError && error.status === 401) {
      // The token is not accepted. The cloud is the authority: it was deactivated or unpaired.
      // A hub may lag behind the configuration: skip it and let the cloud decide (DEC-035).
      if (getPos().device?.deviceToken !== device.deviceToken) return;
      if (node === CLOUD) {
        await markRevoked();
        return;
      }
      refusedHubs.set(node, Date.now() + REFUSED_HUB_MS);
      node = null;
      again = true;
    } else if (!(error instanceof NodeError && error.status < 500)) {
      // Anything but a refusal of the request means "offline".
      node = null;
    }
    setSync({ level: node === null ? 'standalone' : getPos().sync.level, node });
    if (node === null) usePos.setState({ presence: null });
  }
  await updateCounts();
}

let socket: WebSocket | null = null;
let socketNode: string | null = null;

/**
 * On a hub, a WebSocket brings hints in under 2 s (RNF-07, docs/SYNC.md §11.3): new operations
 * or a new configuration make the terminal sync at once. A lost hint loses nothing: the
 * regular cycle pulls anyway.
 */
function watchHub(current: string | null, deviceToken: string): void {
  const hub = current && current !== CLOUD ? current : null;
  if (socket && socketNode !== hub) {
    socket.close();
    socket = null;
    socketNode = null;
  }
  if (!hub || socket || typeof WebSocket === 'undefined') return;
  try {
    const ws = new WebSocket(`${hub.replace(/^http/, 'ws').replace(/\/$/, '')}/ws`);
    socket = ws;
    socketNode = hub;
    ws.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as {
        type?: string;
        printerId?: string;
        ok?: boolean;
        error?: string | null;
      };
      if (message.type === 'hub.hello')
        ws.send(JSON.stringify({ type: 'hello', token: deviceToken }));
      if (message.type === 'sync.applied' || message.type === 'config.changed') requestSync();
      // A printer stopped or started working: the screens that print there warn (DEC-031).
      if (message.type === 'printer.status' && message.printerId) {
        const printerId = message.printerId;
        usePos.setState((state) => ({
          printers: {
            ...state.printers,
            [printerId]: { ok: message.ok === true, error: message.error ?? null },
          },
        }));
      }
    };
    ws.onclose = () => {
      if (socket === ws) {
        socket = null;
        socketNode = null;
      }
    };
  } catch {
    socket = null;
    socketNode = null;
  }
}

/**
 * Asked for while a cycle runs: that cycle may have pushed or pulled already, so another one
 * follows right after it instead of at the next tick (a hint must not wait 2 s, RNF-07).
 */
let again = false;

/**
 * Sends straight to the cloud everything the cloud has not confirmed, and returns how many
 * operations of THIS device are still missing there: 0 means signing out loses nothing. Used
 * before a waiter signs out of their phone (DEC-036); never throws.
 */
export async function flushToCloud(): Promise<number> {
  const device = getPos().device;
  if (!device) return 0;
  await inFlight;
  try {
    await push(CLOUD, device.deviceToken);
  } catch {
    // No network or a refusal: what is left is counted below.
  }
  await updateCounts();
  return getPos().sync.pending;
}

/** Runs one sync cycle now (or joins the one in flight and runs again after it). */
export function syncNow(): Promise<void> {
  if (inFlight) {
    again = true;
    return inFlight;
  }
  again = false;
  inFlight = runOnce().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

function schedule(delay?: number): void {
  if (timer) clearTimeout(timer);
  // A kitchen display in the background is still at its station (DEC-033).
  const hidden =
    deviceApp() !== 'kds' &&
    typeof document !== 'undefined' &&
    document.visibilityState === 'hidden';
  timer = setTimeout(
    () => {
      void syncNow().finally(() => schedule(again ? 0 : undefined));
    },
    delay ?? (hidden ? HIDDEN_INTERVAL_MS : ACTIVE_INTERVAL_MS),
  );
}

/** Asks for a sync soon after a local change or a hint, without waiting for the next tick. */
export function requestSync(): void {
  if (!started) return;
  // A cycle running now may end before this timer and would otherwise reschedule at 2 s.
  if (inFlight) again = true;
  schedule(150);
}

export function startSync(): void {
  if (started) return;
  started = true;
  window.addEventListener('online', () => {
    node = null;
    requestSync();
  });
  window.addEventListener('offline', () => {
    node = null;
    setSync({ level: 'standalone', node: null });
    usePos.setState({ presence: null });
  });
  document.addEventListener('visibilitychange', () => requestSync());
  schedule(0);
}
