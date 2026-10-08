import { isValidPin, type Permission } from '@pos/core';
import { type DeviceApp, deviceApp } from './app';
import { getMeta, setMeta } from './db';
import { dispatch } from './engine';
import { makeOperation } from './operations';
import { getPos, type PosUser, usePos } from './store';

/**
 * PIN on the device, with or without network (RF-A06, RNF-10, DEC-023): the PIN alone identifies
 * the person. HMAC(pinKey, PIN) gives a 4-bit bucket that picks the 1-2 candidates to verify with
 * argon2id. Failures lock the terminal for a while; unlocks and failures are audited through
 * operations.
 */

let worker: Worker | null = null;
let nextRequest = 1;
const waiting = new Map<number, { resolve: (index: number) => void; reject: (e: Error) => void }>();

/** No answer in this time means the worker is broken: the check fails instead of hanging. */
const VERIFY_TIMEOUT_MS = 20_000;

function pinWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./pin.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<{ id: number; index: number }>) => {
      waiting.get(event.data.id)?.resolve(event.data.index);
      waiting.delete(event.data.id);
    };
    // The worker did not load or crashed: every pending check fails and the next one starts over.
    worker.onerror = () => {
      for (const pending of waiting.values()) pending.reject(new Error('PIN worker failed'));
      waiting.clear();
      worker?.terminate();
      worker = null;
    };
  }
  return worker;
}

function verifyHashes(pin: string, hashes: string[]): Promise<number> {
  if (hashes.length === 0) return Promise.resolve(-1);
  const id = nextRequest++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiting.delete(id);
      reject(new Error('PIN check timed out'));
    }, VERIFY_TIMEOUT_MS);
    waiting.set(id, {
      resolve: (index) => {
        clearTimeout(timer);
        resolve(index);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    pinWorker().postMessage({ id, pin, hashes });
  });
}

const hexToBytes = (hex: string) =>
  new Uint8Array(hex.match(/../g)?.map((byte) => Number.parseInt(byte, 16)) ?? []);

/** First 4 bits of HMAC-SHA256(pinKey, PIN), as the server computes `pin_lookup` (DEC-015). */
async function pinBucket(pinKeyHex: string, pin: string): Promise<number> {
  const key = await crypto.subtle.importKey(
    'raw',
    hexToBytes(pinKeyHex),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(pin)),
  );
  return signature[0]! >> 4;
}

export type PinResult =
  | { status: 'ok'; user: PosUser }
  | { status: 'wrong'; attemptsLeft: number }
  | { status: 'locked'; retryAfterSeconds: number }
  | { status: 'invalid' }
  | { status: 'no_credentials' }
  /** The PIN is right, but this person may not work on this kind of device. */
  | { status: 'not_allowed'; displayName: string };

/**
 * What a person needs to unlock each app (RNF-10): the kitchen display is for the kitchen, so
 * its marks are never made by someone without `kitchen.operate` (DEC-030).
 */
const REQUIRED_PERMISSION: Readonly<Record<DeviceApp, Permission | null>> = {
  pos: null,
  kds: 'kitchen.operate',
};

/** Finds the person with this PIN without recording anything (also used for approvals). */
export async function identify(pin: string): Promise<PosUser | null | 'no_credentials'> {
  const { credentials } = getPos();
  if (!credentials?.pinKey) return 'no_credentials';
  const bucket = await pinBucket(credentials.pinKey, pin);
  const candidates = credentials.users.filter((user) => user.pinBucket === bucket);
  const index = await verifyHashes(
    pin,
    candidates.map((user) => user.pinHash),
  );
  const found = index >= 0 ? candidates[index] : undefined;
  if (!found) return null;
  return {
    id: found.id,
    displayName: found.displayName,
    uiLanguage: found.uiLanguage,
    permissions: new Set(found.permissions as Permission[]),
  };
}

/**
 * Unlocks the terminal with a PIN. Wrong attempts are counted on this terminal and lock it for
 * `pinLockMinutes` after `maxPinAttempts` (RNF-10).
 */
export async function unlock(pin: string): Promise<PinResult> {
  if (!isValidPin(pin)) return { status: 'invalid' };
  const { bootstrap } = getPos();
  const security = bootstrap?.location.settings.security ?? {
    maxPinAttempts: 5,
    pinLockMinutes: 5,
  };
  const lock = (await getMeta('pinLock')) ?? { failures: 0, lockedUntil: null };
  if (lock.lockedUntil !== null && lock.lockedUntil > Date.now()) {
    return {
      status: 'locked',
      retryAfterSeconds: Math.ceil((lock.lockedUntil - Date.now()) / 1000),
    };
  }
  const user = await identify(pin);
  if (user === 'no_credentials') return { status: 'no_credentials' };
  if (!user) {
    const failures = (lock.lockedUntil !== null ? 0 : lock.failures) + 1;
    const locked = failures >= security.maxPinAttempts;
    await setMeta('pinLock', {
      failures: locked ? 0 : failures,
      lockedUntil: locked ? Date.now() + security.pinLockMinutes * 60_000 : null,
    });
    await dispatch(
      await makeOperation('terminal.pin_failed', null, { attempt: failures }, { userId: null }),
    );
    return locked
      ? { status: 'locked', retryAfterSeconds: security.pinLockMinutes * 60 }
      : { status: 'wrong', attemptsLeft: security.maxPinAttempts - failures };
  }
  await setMeta('pinLock', { failures: 0, lockedUntil: null });
  const required = REQUIRED_PERMISSION[deviceApp()];
  if (required && !user.permissions.has(required)) {
    return { status: 'not_allowed', displayName: user.displayName };
  }
  usePos.setState({ user });
  await dispatch(await makeOperation('terminal.unlocked', null, {}));
  return { status: 'ok', user };
}

/** Locks the terminal: the next person enters their own PIN. */
export function lockTerminal(): void {
  usePos.setState({ user: null });
}
