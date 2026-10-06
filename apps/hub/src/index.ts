import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPool } from '@pos/db';
import { startHub } from './server';

// En desarrollo se usa el .env de la raíz del monorepo; en la sede, variables del servicio.
const rootEnv = resolve(process.cwd(), '../../.env');
if (existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

const port = Number(process.env.HUB_PORT ?? 4100);
const databaseUrl = process.env.HUB_DATABASE_URL;
const pool = databaseUrl ? createPool(databaseUrl, { connectionLimit: 5 }) : null;

const hub = await startHub({
  port,
  pingDatabase: pool
    ? async () => {
        await pool.query('SELECT 1');
      }
    : null,
});

console.log(`Hub listening on http://0.0.0.0:${hub.port} (WebSocket /ws)`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await hub.close();
    await pool?.end();
    process.exit(0);
  });
}
