import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { addDays } from '@pos/core';
import { createDb, createLogger, loggableError, schema as s } from '@pos/db';
import { and, eq, isNull } from 'drizzle-orm';
import type { Actor } from '../actor';
import { ALL_PERMISSIONS } from '../auth/permissions';
import { exportAuditEvents } from '../services/admin/audit';
import { archiveCashBooks, archiveClosings, archiveReceipts } from '../services/reports';

/**
 * The monthly legal archive (RF-F13, RNF-15, RN-10): once a month the worker writes, for every
 * real organization and location, the previous month's receipts, Z closings and cash books and
 * the organization's audit log as JSON under ARCHIVE_DIR. The backup container keeps that folder
 * 10 years in Switzerland (tag `legal`), even after a restaurant leaves.
 *
 *   pnpm --filter @pos/api archive:loop              # the worker: checks every hour
 *   pnpm --filter @pos/api archive:month 2026-09     # one month by hand
 */

const rootEnv = resolve(import.meta.dirname, '../../../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const logger = createLogger('worker', { task: 'archive' });
const archiveDir = process.env.ARCHIVE_DIR ?? resolve(process.cwd(), '.archive');
const { db, pool } = createDb(process.env.DATABASE_URL!, { connectionLimit: 2 });

/** `2026-10-15` → `2026-09`: the month to archive is the one that ended. */
export const previousMonth = (today: string) => addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7);

const lastDayOf = (month: string) => {
  const [year, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, m, 0)).toISOString().slice(0, 10);
};

const write = (dir: string, name: string, data: unknown) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), `${JSON.stringify(data, null, 2)}\n`);
};

async function archiveMonth(month: string): Promise<{ locations: number }> {
  const period = { from: `${month}-01`, to: lastDayOf(month) };
  const organizations = await db
    .select({ id: s.organizations.id, slug: s.organizations.slug })
    .from(s.organizations)
    .where(and(eq(s.organizations.isTraining, false), isNull(s.organizations.deletedAt)));
  let locations = 0;
  for (const organization of organizations) {
    const rows = await db
      .select({ id: s.locations.id })
      .from(s.locations)
      .where(and(eq(s.locations.organizationId, organization.id), isNull(s.locations.deletedAt)));
    const base = join(archiveDir, organization.slug, month);
    for (const [index, location] of rows.entries()) {
      // The platform itself reads, with every permission, inside one location at a time.
      const actor: Actor = {
        kind: 'support',
        organizationId: organization.id,
        locationId: location.id,
        userId: null,
        permissions: ALL_PERMISSIONS,
        requestId: `archive:${month}`,
      };
      const dir = join(base, location.id);
      const deps = { db };
      write(dir, 'receipts.json', await archiveReceipts(deps, actor, period));
      write(dir, 'closings.json', await archiveClosings(deps, actor, period));
      write(dir, 'cashbooks.json', await archiveCashBooks(deps, actor, period));
      // The audit log is the organization's: written once, next to its locations.
      if (index === 0) {
        write(
          base,
          'audit.json',
          await exportAuditEvents(deps, actor, {
            from: `${period.from}T00:00:00.000Z`,
            to: `${addDays(period.to, 1)}T00:00:00.000Z`,
          }),
        );
      }
      locations += 1;
    }
  }
  return { locations };
}

async function run(month: string) {
  const started = new Date();
  try {
    const { locations } = await archiveMonth(month);
    writeFileSync(join(archiveDir, `.done-${month}`), started.toISOString());
    await db.insert(s.platformJobRuns).values({
      job: 'archive',
      ok: true,
      detail: `${month}: ${locations} location(s)`,
      startedAt: started,
      finishedAt: new Date(),
    });
    logger.info('legal archive written', { month, locations });
  } catch (error) {
    logger.error('legal archive failed', { month, error: loggableError(error) });
    await db
      .insert(s.platformJobRuns)
      .values({
        job: 'archive',
        ok: false,
        detail: `${month}: ${String(error).slice(0, 500)}`,
        startedAt: started,
        finishedAt: new Date(),
      })
      .catch(() => undefined);
  }
}

const [mode, argument] = process.argv.slice(2);
if (mode === 'month') {
  if (!argument || !/^\d{4}-\d{2}$/.test(argument)) {
    logger.error('usage: archive:month YYYY-MM');
    process.exit(1);
  }
  mkdirSync(archiveDir, { recursive: true });
  await run(argument);
  await pool.end();
} else {
  mkdirSync(archiveDir, { recursive: true });
  logger.info('archive loop started', { archiveDir });
  let running = true;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      running = false;
    });
  }
  while (running) {
    const month = previousMonth(new Date().toISOString().slice(0, 10));
    if (!existsSync(join(archiveDir, `.done-${month}`))) await run(month);
    // Once an hour is plenty: a month closes once.
    for (let i = 0; i < 360 && running; i += 1) await new Promise((r) => setTimeout(r, 10_000));
  }
  await pool.end();
}
