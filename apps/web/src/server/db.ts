import 'server-only';
import { createDb, type Database } from '@pos/db';

/** Single connection per process (reused across reloads in development). */
const globalForDb = globalThis as unknown as { posDb?: { db: Database; pool: unknown } };

export function getDb(): Database {
  if (!globalForDb.posDb) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error('DATABASE_URL is not set (see .env.example)');
    }
    globalForDb.posDb = createDb(url);
  }
  return globalForDb.posDb.db;
}
