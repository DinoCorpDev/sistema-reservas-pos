import { existsSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

// drizzle-kit runs from packages/db; the .env lives at the monorepo root.
if (existsSync('../../.env')) {
  process.loadEnvFile('../../.env');
}

export default defineConfig({
  dialect: 'mysql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'mysql://root@127.0.0.1:3306/pos_cloud',
  },
  strict: true,
  verbose: true,
});
