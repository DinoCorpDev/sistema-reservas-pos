import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NextConfig } from 'next';

// Next commands run from apps/web; the monorepo root is two levels up.
const repoRoot = resolve(process.cwd(), '../..');

// A single .env for the whole monorepo (see .env.example at the root).
const rootEnv = resolve(repoRoot, '.env');
if (existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Monorepo packages published as TypeScript source.
  transpilePackages: ['@pos/core', '@pos/db', '@pos/ui'],
  serverExternalPackages: ['mysql2', '@node-rs/argon2'],
  outputFileTracingRoot: repoRoot,
  // ESLint runs once from the root (pnpm lint) and in CI.
  eslint: { ignoreDuringBuilds: true },
  poweredByHeader: false,
};

export default nextConfig;
