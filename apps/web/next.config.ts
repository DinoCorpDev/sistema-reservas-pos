import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NextConfig } from 'next';

// Los comandos de Next corren desde apps/web; la raíz del monorepo está dos niveles arriba.
const repoRoot = resolve(process.cwd(), '../..');

// Un solo .env para todo el monorepo (ver .env.example en la raíz).
const rootEnv = resolve(repoRoot, '.env');
if (existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Paquetes del monorepo publicados como TypeScript fuente.
  transpilePackages: ['@pos/core', '@pos/db', '@pos/ui'],
  serverExternalPackages: ['mysql2', '@node-rs/argon2'],
  outputFileTracingRoot: repoRoot,
  // ESLint corre una sola vez desde la raíz (pnpm lint) y en CI.
  eslint: { ignoreDuringBuilds: true },
  poweredByHeader: false,
};

export default nextConfig;
