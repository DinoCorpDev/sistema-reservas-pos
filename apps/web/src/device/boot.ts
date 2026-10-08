import { deviceApp, TERMINAL_TYPES_OF } from './app';
import { loadClock } from './clock';
import { getMeta, type PairedDevice, setMeta, storePairedDeviceFor } from './db';
import { refold } from './engine';
import { CLOUD, callNode } from './http';
import { registerPosWorker } from './service-worker';
import { usePos } from './store';
import { refreshConfiguration, startSync } from './sync';

/**
 * Start of a device app (POS or KDS) on the device: the service worker (offline shell), the
 * local database, the engine and the sync loop. Works without network once it is paired.
 */
export async function bootDevice(): Promise<void> {
  void registerPosWorker().then((registration) => {
    if (!registration) return;
    const check = () => usePos.setState({ updateWaiting: Boolean(registration.waiting) });
    registration.addEventListener('updatefound', () => {
      registration.installing?.addEventListener('statechange', check);
    });
    check();
  });
  await loadClock();
  const [device, bootstrap, credentials] = await Promise.all([
    getMeta('device'),
    getMeta('bootstrap'),
    getMeta('credentials'),
  ]);
  usePos.setState({
    device: device ?? null,
    bootstrap: bootstrap ?? null,
    credentials: credentials ?? null,
  });
  await refold();
  usePos.setState({ ready: true });
  if (device) startSync();
}

/** The code belongs to a hub: it is paired on the hub itself, never in a browser. */
export class HubCodeError extends Error {
  override readonly name = 'HubCodeError';
}

/**
 * Pairs this device with a code from the backoffice (RF-A06): it receives its device token and
 * its location, downloads the configuration and asks the browser to keep the data (§8). A code
 * of a kitchen display entered in the POS (or the other way round) is not lost: the pairing is
 * handed to the right app, which opens (DEC-030).
 */
export async function pairDevice(code: string): Promise<void> {
  const paired = await callNode<{
    deviceToken: string;
    terminal: { id: string; name: string; type: string; orderNumberPrefix: string };
    location: { id: string };
    organizationId: string;
  }>(CLOUD, '/terminals/pair', { method: 'POST', body: { code } });
  const device: PairedDevice = {
    terminalId: paired.terminal.id,
    terminalName: paired.terminal.name,
    terminalType: paired.terminal.type,
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
  await setMeta('device', device);
  usePos.setState({ device });
  await refreshConfiguration(device.deviceToken);
  const persisted =
    typeof navigator !== 'undefined' && navigator.storage?.persist
      ? await navigator.storage.persist().catch(() => false)
      : false;
  await setMeta('storagePersisted', persisted);
  startSync();
}
