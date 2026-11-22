import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema';

/**
 * MySQL pool in UTC: `timezone: 'Z'` so mysql2 reads and writes DATETIME as UTC, and each
 * connection sets `time_zone = '+00:00'` so CURRENT_TIMESTAMP is UTC as well.
 *
 * MySQL 8 and MariaDB (DEC-052):
 * - `jsonStrings`: JSON always arrives as text and the `json` column type parses it. MySQL sends
 *   JSON as its own type (mysql2 would parse it) but MariaDB sends it as LONGTEXT.
 * - `wait_timeout` of at least 5 minutes per connection: shared hosts close idle connections
 *   after a few seconds, before the pool drops them (`idleTimeout`, 60 s).
 */
export function createPool(url: string, options: { connectionLimit?: number } = {}) {
  const pool = mysql.createPool({
    uri: url,
    timezone: 'Z',
    connectionLimit: options.connectionLimit ?? 10,
    supportBigNumbers: true,
    bigNumberStrings: false,
    jsonStrings: true,
  });
  pool.pool.on('connection', (connection) => {
    connection.query(
      "SET time_zone = '+00:00', wait_timeout = CAST(GREATEST(@@session.wait_timeout, 300) AS UNSIGNED)",
    );
  });
  return pool;
}

export function createDb(url: string, options: { connectionLimit?: number } = {}) {
  const pool = createPool(url, options);
  const db = drizzle(pool, { schema, mode: 'default' });
  return { db, pool };
}

export type Database = ReturnType<typeof createDb>['db'];
