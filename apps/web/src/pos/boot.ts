import { loadClock } from './clock';
import { getMeta, setMeta } from './db';
import { refold } from './engine';
import { CLOUD, callNode } from './http';
import { registerPosWorker } from './service-worker';
import { usePos } from './store';
import { refreshConfiguration, startSync } from './sync';

/**
 * Start of the POS on the device: the service worker (offline shell), the local database, the
 * engine and the sync loop. Works without network once the device has been paired.
 */
export async function bootPos(): Promise<void> {
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

/**
 * Pairs this device with a code from the backoffice (RF-A06): it receives its device token and
 * its location, downloads the configuration and asks the browser to keep the data (§8).
 */
export async function pairDevice(code: string): Promise<void> {
  const paired = await callNode<{
    deviceToken: string;
    terminal: { id: string; name: string; orderNumberPrefix: string };
    location: { id: string };
    organizationId: string;
  }>(CLOUD, '/terminals/pair', { method: 'POST', body: { code } });
  const device = {
    terminalId: paired.terminal.id,
    terminalName: paired.terminal.name,
    deviceToken: paired.deviceToken,
    organizationId: paired.organizationId,
    locationId: paired.location.id,
    prefix: paired.terminal.orderNumberPrefix,
    pairedAt: new Date().toISOString(),
  };
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
