import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createDb, createLogger, loggableError } from '@pos/db';
import {
  acmeAuthority,
  acmeDirectoryUrl,
  cloudflareDns,
  createAccountKey,
} from '../services/platform/hub-tls-providers';
import { hubDnsZone, processHubCertificates } from '../services/sync/hub-certificate';

/**
 * Certificates of the LAN hubs (DEC-028): every minute, issues what the hubs asked for and
 * renews what is close to its end. Runs in the worker container when `HUB_DNS_ZONE` is set:
 * `pnpm --filter @pos/api hub-certs:loop`. Without a zone it waits quietly (HTTP hubs only).
 *
 * - HUB_DNS_ZONE: the zone of the hubs' names, e.g. hub.pos.example.ch
 * - CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID: DNS of that zone («DNS edit» on it only)
 * - ACME_DIRECTORY: production (default), staging or a directory URL; ACME_EMAIL
 * - ACME_ACCOUNT_KEY_PATH: where the ACME account key is kept (created on the first run)
 */

const rootEnv = resolve(import.meta.dirname, '../../../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const logger = createLogger('worker', { task: 'hub-certificates' });
const intervalMs = Number(process.env.HUB_CERTS_INTERVAL_MS ?? 60_000);

function accountKey(): Promise<string> | string {
  const path = process.env.ACME_ACCOUNT_KEY_PATH ?? resolve(process.cwd(), '.acme-account.pem');
  if (existsSync(path)) return readFileSync(path, 'utf8');
  return createAccountKey().then((pem) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, pem, { mode: 0o600 });
    logger.info('ACME account key created', { path });
    return pem;
  });
}

let running = true;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    running = false;
  });
}
const sleep = async (ms: number) => {
  for (let waited = 0; waited < ms && running; waited += 1_000) {
    await new Promise((r) => setTimeout(r, 1_000));
  }
};

const zone = hubDnsZone();
if (!zone) {
  logger.info('HUB_DNS_ZONE not set: hubs stay on HTTP, nothing to issue');
  while (running) await sleep(60 * 60_000);
  process.exit(0);
}
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const zoneId = process.env.CLOUDFLARE_ZONE_ID;
const email = process.env.ACME_EMAIL;
if (!apiToken || !zoneId || !email) {
  logger.error('HUB_DNS_ZONE needs CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID and ACME_EMAIL');
  process.exit(1);
}

const { db, pool } = createDb(process.env.DATABASE_URL!, { connectionLimit: 2 });
const dns = cloudflareDns({ apiToken, zoneId });
const authority = acmeAuthority({
  directoryUrl: acmeDirectoryUrl(process.env.ACME_DIRECTORY),
  email,
  accountKeyPem: await accountKey(),
});
logger.info('hub certificates started', {
  zone,
  directory: acmeDirectoryUrl(process.env.ACME_DIRECTORY),
});

while (running) {
  try {
    const result = await processHubCertificates({ db, dns, authority, logger });
    if (result.issued + result.failed > 0) logger.info('hub certificates round', result);
  } catch (error) {
    logger.error('hub certificates round failed', { error: loggableError(error) });
  }
  await sleep(intervalMs);
}
await pool.end();
