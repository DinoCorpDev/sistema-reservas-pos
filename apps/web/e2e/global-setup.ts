import { setupHubTestDatabase, setupTestDatabase } from '@pos/db/testing';

/**
 * Fresh E2E databases: the cloud with the demo restaurant and the empty one of the LAN hub
 * (TEST_DATABASE_URL and TEST_HUB_DATABASE_URL are set in playwright.config.ts).
 */
export default async function globalSetup() {
  await setupTestDatabase();
  await setupHubTestDatabase();
}
