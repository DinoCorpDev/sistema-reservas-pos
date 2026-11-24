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
 * - A connection idle for `STALE_AFTER_MS` is pinged before it is handed out, and replaced if the
 *   server closed it: a serverless function that slept keeps its pool, but the host does not
 *   keep the connections ("Connection lost: The server closed the connection").
 */
const STALE_AFTER_MS = 30_000;

type CorePool = mysql.Pool['pool'];
type CoreConnection = Parameters<Parameters<CorePool['getConnection']>[0]>[1];

/** Pings a connection that sat idle before lending it; a dead one is destroyed and replaced. */
function checkIdleConnections(core: CorePool, staleAfterMs: number) {
  const lastUsed = new WeakMap<object, number>();
  core.on('connection', (connection) => lastUsed.set(connection, Date.now()));
  core.on('release', (connection) => lastUsed.set(connection, Date.now()));
  const borrow = core.getConnection.bind(core);
  const getConnection: CorePool['getConnection'] = (callback) => {
    borrow((error, connection) => {
      if (error) return callback(error, connection);
      const idleMs = Date.now() - (lastUsed.get(connection) ?? Date.now());
      if (idleMs < staleAfterMs) return callback(null, connection);
      (connection as CoreConnection).ping((pingError) => {
        if (!pingError) return callback(null, connection);
        connection.destroy();
        getConnection(callback);
      });
    });
  };
  core.getConnection = getConnection;
}

interface PoolOptions {
  connectionLimit?: number;
  /** Idle time after which a connection is pinged before use; tests lower it. */
  staleAfterMs?: number;
}

export function createPool(url: string, options: PoolOptions = {}) {
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
  checkIdleConnections(pool.pool, options.staleAfterMs ?? STALE_AFTER_MS);
  return pool;
}

export function createDb(url: string, options: PoolOptions = {}) {
  const pool = createPool(url, options);
  const db = drizzle(pool, { schema, mode: 'default' });
  return { db, pool };
}

export type Database = ReturnType<typeof createDb>['db'];
