import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Monorepo root (packages/db/src → ../../..). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** Loads the root `.env` if it exists. Variables already defined (e.g. in CI) take precedence. */
export function loadRootEnv(): void {
  const file = resolve(REPO_ROOT, '.env');
  if (existsSync(file)) {
    process.loadEnvFile(file);
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}
