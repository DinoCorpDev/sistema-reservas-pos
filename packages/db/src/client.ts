import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema';

/**
 * Pool MySQL en UTC: `timezone: 'Z'` para que mysql2 lea y escriba DATETIME como UTC, y cada
 * conexión fija `time_zone = '+00:00'` para que CURRENT_TIMESTAMP también sea UTC.
 */
export function createPool(url: string, options: { connectionLimit?: number } = {}) {
  const pool = mysql.createPool({
    uri: url,
    timezone: 'Z',
    connectionLimit: options.connectionLimit ?? 10,
    supportBigNumbers: true,
    bigNumberStrings: false,
  });
  pool.pool.on('connection', (connection) => {
    connection.query("SET time_zone = '+00:00'");
  });
  return pool;
}

export function createDb(url: string, options: { connectionLimit?: number } = {}) {
  const pool = createPool(url, options);
  const db = drizzle(pool, { schema, mode: 'default' });
  return { db, pool };
}

export type Database = ReturnType<typeof createDb>['db'];
