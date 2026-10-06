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

// next-intl request config. Wired by hand instead of `createNextIntlPlugin`: the plugin loads
// @swc/core, whose native addon materializes a cache under C:\ (full on the dev machine, DEC-013).
const intlRequestConfig = './src/i18n/request.ts';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Monorepo packages published as TypeScript source.
  transpilePackages: ['@pos/core', '@pos/db', '@pos/ui', '@pos/api'],
  serverExternalPackages: ['mysql2', '@node-rs/argon2'],
  outputFileTracingRoot: repoRoot,
  // ESLint runs once from the root (pnpm lint) and in CI.
  eslint: { ignoreDuringBuilds: true },
  poweredByHeader: false,
  turbopack: { resolveAlias: { 'next-intl/config': intlRequestConfig } },
  webpack(config: { resolve: { alias: Record<string, string> } }) {
    config.resolve.alias['next-intl/config'] = resolve(process.cwd(), intlRequestConfig);
    return config;
  },
};

export default nextConfig;
