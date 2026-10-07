import { setupTestDatabase } from '@pos/db/testing';

/** Fresh E2E database with the demo restaurant (TEST_DATABASE_URL is set in playwright.config.ts). */
export default async function globalSetup() {
  await setupTestDatabase();
}
