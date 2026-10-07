import { loadRootEnv, requireEnv } from './env';
import { createDb } from './client';
import { createDatabase, migrateDatabase } from './ops';
import { seedDemoRestaurant } from './seed/demo';

// Development/test credentials of the seed, for E2E tests (never valid in production).
export { DEMO_BACKOFFICE_PASSWORD, DEMO_SUPPORT_STAFF, DEMO_USERS } from './seed/data/restaurant';

/**
 * Integration tests run against their own database (`<DATABASE_URL name>_test`), recreated,
 * migrated and seeded once per run. The development database is never touched, which matters
 * because append-only tables (audit, receipts, closings) cannot be cleaned up.
 */
export function testDatabaseUrl(): string {
  loadRootEnv();
  const explicit = process.env.TEST_DATABASE_URL;
  if (explicit) return explicit;
  const url = new URL(requireEnv('DATABASE_URL'));
  url.pathname = `${url.pathname.replace(/\/$/, '')}_test`;
  return url.toString();
}

/** Vitest globalSetup: fresh test database with the demo restaurant. */
export async function setupTestDatabase(): Promise<void> {
  const url = testDatabaseUrl();
  await createDatabase(url, { reset: true });
  await migrateDatabase(url);
  const { db, pool } = createDb(url, { connectionLimit: 2 });
  try {
    await seedDemoRestaurant(db);
  } finally {
    await pool.end();
  }
}

export default setupTestDatabase;

/** The hub's test database (`<HUB_DATABASE_URL name>_test`): empty schema, filled by the hub. */
export function hubTestDatabaseUrl(): string {
  loadRootEnv();
  const explicit = process.env.TEST_HUB_DATABASE_URL;
  if (explicit) return explicit;
  const url = new URL(requireEnv('HUB_DATABASE_URL'));
  url.pathname = `${url.pathname.replace(/\/$/, '')}_test`;
  return url.toString();
}

export async function setupHubTestDatabase(): Promise<void> {
  const url = hubTestDatabaseUrl();
  await createDatabase(url, { reset: true });
  await migrateDatabase(url);
}
