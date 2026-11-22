import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import mysql from 'mysql2/promise';
import { createDb } from './client';

export const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../drizzle');

const SAFE_RESET_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  'mysql',
  'mysql-cloud',
  'mysql-hub',
]);

function parseDatabaseUrl(url: string) {
  const parsed = new URL(url);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!/^[A-Za-z0-9_]+$/.test(database)) {
    throw new Error(`Invalid database name in URL: "${database}"`);
  }
  parsed.pathname = '/';
  return { database, serverUrl: parsed.toString(), host: parsed.hostname };
}

/**
 * Creates the database if it does not exist (utf8mb4). With `reset` it drops it first, only on
 * local hosts or in CI: never against a remote server.
 */
export async function createDatabase(url: string, options: { reset?: boolean } = {}) {
  const { database, serverUrl, host } = parseDatabaseUrl(url);
  if (options.reset) {
    const allowed = SAFE_RESET_HOSTS.has(host) || process.env.CI === 'true';
    if (!allowed || process.env.NODE_ENV === 'production') {
      throw new Error(`Refusing to reset database "${database}" on host "${host}".`);
    }
  }
  const connection = await mysql.createConnection(serverUrl);
  try {
    if (options.reset) {
      await connection.query(`DROP DATABASE IF EXISTS \`${database}\``);
    }
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
    );
  } finally {
    await connection.end();
  }
  return database;
}

/**
 * MariaDB has no UUID_TO_BIN (MySQL 8), and migrations 0009 and 0012 call it. On MariaDB an
 * equivalent stored function (same result as MySQL without swap_flag) is created first, so the
 * migrations stay as they were applied (DEC-052). On MySQL nothing changes.
 */
async function ensureMariaDbCompat(pool: ReturnType<typeof createDb>['pool']) {
  const [rows] = await pool.query('SELECT VERSION() AS version');
  const [{ version }] = rows as [{ version: string }];
  if (!/mariadb/i.test(version)) return;
  await pool.query(
    "CREATE FUNCTION IF NOT EXISTS UUID_TO_BIN(value CHAR(36)) RETURNS BINARY(16) DETERMINISTIC RETURN UNHEX(REPLACE(value, '-', ''))",
  );
}

export async function migrateDatabase(url: string) {
  const { db, pool } = createDb(url, { connectionLimit: 1 });
  try {
    await ensureMariaDbCompat(pool);
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await pool.end();
  }
}
