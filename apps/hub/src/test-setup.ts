import { setupHubTestDatabase, setupTestDatabase } from '@pos/db/testing';

/** Vitest globalSetup of the hub integration tests: a seeded cloud and an empty hub database. */
export default async function setup(): Promise<void> {
  await setupTestDatabase();
  await setupHubTestDatabase();
}
