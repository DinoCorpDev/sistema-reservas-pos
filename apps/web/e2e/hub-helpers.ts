import { type ChildProcess, spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newId, parseLocationSettings } from '@pos/core';
import { createDb, normalizePairingCode, pairingCode, schema as s, sha256Hex } from '@pos/db';
import { hubTestDatabaseUrl, testDatabaseUrl } from '@pos/db/testing';
import { and, eq } from 'drizzle-orm';

/**
 * The LAN hub for the kitchen E2E tests (Phase 3): a real hub process on its own database and
 * port, paired with the E2E cloud like at a location, and the location configured to use it.
 * Everything is undone afterwards, so the other specs keep running without a hub.
 */

export const HUB_PORT = 4199;
export const HUB_URL = `http://localhost:${HUB_PORT}`;
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const stateDir = resolve(repoRoot, '.cache/e2e-hub');

async function withDb<T>(work: (db: ReturnType<typeof createDb>['db']) => Promise<T>) {
  const { db, pool } = createDb(testDatabaseUrl(), { connectionLimit: 1 });
  try {
    return await work(db);
  } finally {
    await pool.end();
  }
}

/** The demo location's hubs (`settings.sync.hubUrls`); [] = no hub. */
export function setHubUrls(hubUrls: string[]) {
  return withDb(async (db) => {
    const [location] = await db.select().from(s.locations).limit(1);
    const settings = { ...parseLocationSettings(location!.settings), sync: { hubUrls } };
    await db.update(s.locations).set({ settings }).where(eq(s.locations.id, location!.id));
  });
}

/** Points a seeded printer (by kind) to a simulated one on this machine. */
export function pointPrinter(kind: 'kitchen' | 'receipt', port: number, host = '127.0.0.1') {
  return withDb((db) => db.update(s.printers).set({ host, port }).where(eq(s.printers.kind, kind)));
}

/**
 * A terminal of the demo location with a fresh pairing code, as the backoffice would create it.
 * The kitchen tests use their own terminals, so the other specs' terminals stay untouched.
 */
export function terminalPairingCode(
  prefix: string,
  fields: { name: string; type: 'pos' | 'hub' | 'kds' },
) {
  return withDb(async (db) => {
    const [location] = await db.select().from(s.locations).limit(1);
    const code = pairingCode();
    const pairing = {
      pairingCodeHash: sha256Hex(normalizePairingCode(code)),
      pairingExpiresAt: new Date(Date.now() + 15 * 60_000),
      isActive: true,
    };
    const [existing] = await db
      .select({ id: s.terminals.id })
      .from(s.terminals)
      .where(
        and(eq(s.terminals.locationId, location!.id), eq(s.terminals.orderNumberPrefix, prefix)),
      );
    if (existing) {
      await db.update(s.terminals).set(pairing).where(eq(s.terminals.id, existing.id));
    } else {
      await db.insert(s.terminals).values({
        id: newId(),
        organizationId: location!.organizationId,
        locationId: location!.id,
        name: fields.name,
        type: fields.type,
        orderNumberPrefix: prefix,
        ...pairing,
      });
    }
    return code;
  });
}

const hubPairingCode = () => terminalPairingCode('HE', { name: 'Hub E2E', type: 'hub' });

export interface RunningHub {
  process: ChildProcess;
  output: string[];
  stop: () => Promise<void>;
}

/** Starts the hub (paired on its first start) and waits until it serves its health check. */
export async function startHub(): Promise<RunningHub> {
  rmSync(stateDir, { recursive: true, force: true });
  mkdirSync(stateDir, { recursive: true });
  const code = await hubPairingCode();
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: resolve(repoRoot, 'apps/hub'),
    env: {
      ...process.env,
      HUB_PORT: String(HUB_PORT),
      HUB_DATABASE_URL: hubTestDatabaseUrl(),
      HUB_CLOUD_URL: 'http://localhost:3100',
      HUB_PAIRING_CODE: code,
      HUB_STATE_FILE: resolve(stateDir, '.hub-state.json'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output: string[] = [];
  child.stdout?.on('data', (chunk: Buffer) => output.push(chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => output.push(chunk.toString()));
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`The hub exited:\n${output.join('')}`);
    try {
      const health = await fetch(`${HUB_URL}/health`);
      if (health.ok && output.join('').includes('Hub listening')) break;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) throw new Error(`The hub did not start:\n${output.join('')}`);
    await new Promise((done) => setTimeout(done, 500));
  }
  return {
    process: child,
    output,
    stop: () =>
      new Promise<void>((done) => {
        if (child.exitCode !== null) return done();
        child.once('exit', () => done());
        child.kill();
      }),
  };
}
