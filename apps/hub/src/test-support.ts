import { type Database, schema as s } from '@pos/db';

/**
 * Each hub integration file starts from an empty operation log: the files share the hub's test
 * database (created once by `test-setup.ts`) and count operations, cursors and print jobs.
 * Only for the test database; the configuration (organization, location, terminals) stays.
 */
export async function resetHubLog(db: Database): Promise<void> {
  await db.delete(s.printJobs);
  await db.delete(s.syncOperations);
  await db.delete(s.orderNumberClaims);
  await db.delete(s.orderNumberSequences);
}
