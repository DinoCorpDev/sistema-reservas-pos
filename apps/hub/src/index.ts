import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { APP_VERSION, createApiApp, resolveTerminal } from '@pos/api';
import { createDb, createLogger } from '@pos/db';
import { cloudFetcher, cloudJson } from './cloud';
import { syncConfig } from './config-sync';
import { startCloudLink } from './node';
import { PrintConfigCache } from './printing/config';
import { tcpTransport } from './printing/transport';
import { PrintWorker } from './printing/worker';
import { startHub } from './server';
import { StateFile } from './state';

/**
 * The LAN hub of a location (docs/SYNC.md §11, DEC-028). Configuration by environment:
 * - HUB_DATABASE_URL: its own MySQL (same schema as the cloud).
 * - HUB_CLOUD_URL: the cloud (default http://localhost:3000).
 * - HUB_PAIRING_CODE: on the first start, a pairing code of a terminal of type `hub`.
 * - HUB_STATE_FILE: where the device token and cursors are kept (default .hub-state.json); the
 *   printing configuration is kept next to it (`.hub-config.json`).
 * - HUB_AUTHORITY=false for a standby hub that must not number orders (§11.4).
 * - HUB_ALLOWED_ORIGINS: comma-separated origins of the POS (default any).
 */

// In development the monorepo root .env is used; at the location, the service's variables.
const rootEnv = resolve(process.cwd(), '../../.env');
if (existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

const logger = createLogger('hub');
const port = Number(process.env.HUB_PORT ?? 4100);
const databaseUrl = process.env.HUB_DATABASE_URL;
if (!databaseUrl) {
  logger.error('HUB_DATABASE_URL is required');
  process.exit(1);
}
const cloudUrl = process.env.HUB_CLOUD_URL ?? 'http://localhost:3000';
const stateFile = process.env.HUB_STATE_FILE ?? resolve(process.cwd(), '.hub-state.json');
const state = new StateFile(stateFile);
const printConfig = new PrintConfigCache(join(dirname(stateFile), '.hub-config.json'));
const authority = process.env.HUB_AUTHORITY !== 'false';
const cloud = cloudFetcher(cloudUrl, () => state.value.deviceToken);

if (!state.value.deviceToken) {
  const code = process.env.HUB_PAIRING_CODE;
  if (!code) {
    // Not paired yet (e.g. `pnpm dev` on a laptop): only /health, so the rest keeps running.
    logger.warn(
      'The hub is not paired: create a terminal of type "hub" in the backoffice and start the hub with HUB_PAIRING_CODE=<code>. Serving /health only.',
    );
    const idle = await startHub({ port, pingDatabase: null });
    logger.info('hub unpaired, serving /health only', { port: idle.port });
    await new Promise(() => undefined);
  }
  const paired = await cloudJson<{
    deviceToken: string;
    organizationId: string;
    location: { id: string };
  }>(cloud, '/terminals/pair', { method: 'POST', body: { code, appVersion: APP_VERSION } });
  state.update({
    deviceToken: paired.deviceToken,
    organizationId: paired.organizationId,
    locationId: paired.location.id,
  });
  logger.info('hub paired with the cloud');
}

const { db, pool } = createDb(databaseUrl, { connectionLimit: 8 });
try {
  await syncConfig(db, cloud);
} catch (error) {
  // Without internet the hub starts with the configuration it already has.
  logger.warn('cloud not reachable at start; using the stored configuration', {
    error: String(error),
  });
}
if (!(await printConfig.refresh(cloud)) && !printConfig.value) {
  logger.warn('no printing configuration yet: the hub prints once it reaches the cloud');
}

const scope = { organizationId: state.value.organizationId!, locationId: state.value.locationId! };
const located = logger.child(scope);
const api = createApiApp({
  db,
  logger: located,
  modules: 'sync',
  node: { kind: 'hub', authority, configVersion: () => state.value.cloudConfigVersion },
});

let link: ReturnType<typeof startCloudLink> | null = null;
let printer: PrintWorker | null = null;
const hub = await startHub({
  port,
  pingDatabase: async () => {
    await pool.query('SELECT 1');
  },
  api,
  onPushed: () => {
    link?.kick();
    printer?.kick();
  },
  printers: () => printer?.printers() ?? {},
  allowedOrigins: process.env.HUB_ALLOWED_ORIGINS?.split(',').map((o) => o.trim()),
  realtime: {
    authority,
    authenticate: async (token) => {
      try {
        const terminal = await resolveTerminal(db, token);
        return terminal.locationId === scope.locationId;
      } catch {
        return false;
      }
    },
  },
});
printer = new PrintWorker({
  db,
  scope,
  state,
  config: () => printConfig.value,
  transport: tcpTransport(),
  cloud,
  broadcast: hub.broadcast,
});
printer.start();
link = startCloudLink({
  db,
  cloud,
  scope,
  state,
  broadcast: hub.broadcast,
  onPulled: () => printer?.kick(),
  onConfigChanged: async () => {
    await printConfig.refresh(cloud);
    printer?.kick();
  },
  onRevoked: () => void revoke(),
});

/**
 * Deactivated or unpaired in the backoffice (DEC-035): the hub forgets its token and stops
 * serving the terminals and printing; they go to the cloud by themselves and keep everything
 * not confirmed yet. Only /health stays, until it is restarted with a new pairing code.
 */
async function revoke(): Promise<void> {
  located.error(
    'This hub was deactivated or unpaired in the backoffice: it stops serving the terminals. Create a new pairing code for its terminal and restart it with HUB_PAIRING_CODE=<code>.',
  );
  state.update({ deviceToken: null });
  printer?.stop();
  link?.stop();
  await hub.close();
  const idle = await startHub({ port, pingDatabase: null });
  logger.info('hub unpaired, serving /health only', { port: idle.port });
}

located.info('hub listening', {
  port: hub.port,
  cloudUrl,
  authority,
  printers: printConfig.value ? printConfig.value.printers.length : null,
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    printer?.stop();
    link?.stop();
    await hub.close();
    await pool.end();
    process.exit(0);
  });
}
