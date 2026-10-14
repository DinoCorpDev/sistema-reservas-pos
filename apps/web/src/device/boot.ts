import type { Permission } from '@pos/core';
import { deviceApp, isPhone, TERMINAL_TYPES_OF } from './app';
import { loadClock } from './clock';
import {
  deleteMeta,
  getMeta,
  type PairedDevice,
  resetDeviceData,
  setMeta,
  storePairedDeviceFor,
  unconfirmedCount,
} from './db';
import { dispatch, refold } from './engine';
import { CLOUD, callNode, NodeError } from './http';
import { preferredLanguage } from './language';
import { makeOperation } from './operations';
import { registerPosWorker } from './service-worker';
import { usePos } from './store';
import { refreshConfiguration, startSync } from './sync';

/**
 * Start of a device app (POS or KDS) on the device: the service worker (offline shell), the
 * local database, the engine and the sync loop. Works without network once it is paired.
 */
export async function bootDevice(): Promise<void> {
  // A new version is offered by the update banner on every screen.
  void registerPosWorker();
  await loadClock();
  const [device, bootstrap, credentials, revoked] = await Promise.all([
    getMeta('device'),
    getMeta('bootstrap'),
    getMeta('credentials'),
    getMeta('revoked'),
  ]);
  // A waiter's phone unpaired in the backoffice keeps nothing of the shift once the cloud has
  // all of it: it starts over at the pairing screen (DEC-036).
  if (revoked && isPhone(device) && (await unconfirmedCount()) === 0) {
    await resetDeviceData();
    usePos.setState({ ready: true });
    return;
  }
  usePos.setState({
    device: device ?? null,
    bootstrap: bootstrap ?? null,
    credentials: credentials ?? null,
    // Deactivated in the backoffice: a reload does not bring the screens back (DEC-035).
    revoked: revoked !== undefined,
  });
  await refold();
  usePos.setState({ ready: true });
  if (device && !revoked) startSync();
}

/** The code belongs to a hub: it is paired on the hub itself, never in a browser. */
export class HubCodeError extends Error {
  override readonly name = 'HubCodeError';
}

/**
 * The code belongs to another location while operations of the current one have not reached
 * the cloud yet: pairing there would lose them (DEC-035).
 */
export class PendingElsewhereError extends Error {
  override readonly name = 'PendingElsewhereError';
  constructor(readonly pending: number) {
    super(`${pending} operations of the previous location are not in the cloud yet`);
  }
}

/** The code is for a waiter's phone: the waiter's PIN is needed too (DEC-036). */
export class PinRequiredError extends Error {
  override readonly name = 'PinRequiredError';
}

/** Why the server refused a phone pairing (DEC-036), from `error.details.reason`. */
export const phonePairingRefusal = (cause: unknown): string | null => {
  if (!(cause instanceof NodeError)) return null;
  const reason = (cause.details as { reason?: unknown } | undefined)?.reason;
  return typeof reason === 'string' ? reason : null;
};

/**
 * Pairs this device with a code from the backoffice (RF-A06): it receives its device token and
 * its location, downloads the configuration and asks the browser to keep the data (§8). A code
 * of a kitchen display entered in the POS (or the other way round) is not lost: the pairing is
 * handed to the right app, which opens (DEC-030). A code for a waiter's phone also takes the
 * waiter's PIN: the phone becomes theirs and opens unlocked (DEC-036).
 */
export async function pairDevice(code: string, pin?: string): Promise<void> {
  const paired = await callNode<{
    deviceToken: string;
    terminal: {
      id: string;
      name: string;
      type: string;
      orderNumberPrefix: string;
      userId: string | null;
    };
    location: { id: string };
    organizationId: string;
    user?: { id: string; displayName: string; uiLanguage: string; permissions: Permission[] };
  }>(CLOUD, '/terminals/pair', { method: 'POST', body: pin ? { code, pin } : { code } }).catch(
    (cause: unknown) => {
      throw phonePairingRefusal(cause) === 'pin_required'
        ? new PinRequiredError('This code pairs a waiter phone')
        : cause;
    },
  );
  const device: PairedDevice = {
    terminalId: paired.terminal.id,
    terminalName: paired.terminal.name,
    terminalType: paired.terminal.type,
    ownerUserId: paired.terminal.userId,
    ownerName: paired.user?.displayName ?? null,
    deviceToken: paired.deviceToken,
    organizationId: paired.organizationId,
    locationId: paired.location.id,
    prefix: paired.terminal.orderNumberPrefix,
    pairedAt: new Date().toISOString(),
  };
  const type = paired.terminal.type;
  if (!TERMINAL_TYPES_OF[deviceApp()].includes(type)) {
    if (type === 'hub') throw new HubCodeError('This code pairs a hub');
    const target = TERMINAL_TYPES_OF.kds.includes(type) ? 'kds' : 'pos';
    await storePairedDeviceFor(target, device);
    window.location.assign(`/${target}`);
    return;
  }
  // Paired again after a deactivation (DEC-035): at the same location the operations not sent yet
  // go out with the new token; another location starts from scratch once nothing would be lost.
  const previous = await getMeta('device');
  if (
    previous &&
    (previous.organizationId !== device.organizationId || previous.locationId !== device.locationId)
  ) {
    const pending = await unconfirmedCount();
    if (pending > 0) throw new PendingElsewhereError(pending);
    await resetDeviceData();
  }
  await deleteMeta('revoked');
  await setMeta('device', device);
  usePos.setState({ device, revoked: false });
  await refreshConfiguration(device.deviceToken);
  const persisted =
    typeof navigator !== 'undefined' && navigator.storage?.persist
      ? await navigator.storage.persist().catch(() => false)
      : false;
  await setMeta('storagePersisted', persisted);
  startSync();
  // The waiter just proved their PIN to the server: their phone opens without asking again.
  if (paired.user) {
    usePos.setState({
      user: {
        id: paired.user.id,
        displayName: paired.user.displayName,
        uiLanguage: await preferredLanguage(paired.user.id, paired.user.uiLanguage),
        permissions: new Set(paired.user.permissions),
      },
    });
    await dispatch(await makeOperation('terminal.unlocked', null, {}));
  }
}
