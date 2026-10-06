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
 * Crea la base si no existe (utf8mb4). Con `reset` la borra antes, solo en hosts locales o en CI:
 * nunca contra un servidor remoto.
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

export async function migrateDatabase(url: string) {
  const { db, pool } = createDb(url, { connectionLimit: 1 });
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await pool.end();
  }
}
