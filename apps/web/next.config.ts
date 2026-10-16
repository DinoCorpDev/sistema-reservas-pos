import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import withSerwistInit from '@serwist/next';
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

// One id per build: Next's build id and the precache revision of /pos and /kds, so a new build
// always replaces the cached shells together with the chunks they reference (docs/SYNC.md §13).
const buildId = process.env.POS_BUILD_ID ?? Date.now().toString(36);
// The version devices report and support sees (RNF-17): set at deploy, else this build's id.
const appVersion = process.env.APP_VERSION?.trim() || buildId;

const withSerwist = withSerwistInit({
  swSrc: 'src/sw/sw.ts',
  swDest: 'public/sw.js',
  // Only the POS and the KDS register the worker; the backoffice stays online-only.
  register: false,
  // Never reload the POS by itself when the connection returns (it may be taking a payment).
  reloadOnOnline: false,
  additionalPrecacheEntries: [
    { url: '/pos', revision: buildId },
    { url: '/kds', revision: buildId },
    // What an installed POS or KDS asks for at launch, also without network.
    ...['pos', 'kds'].flatMap((app) => [
      { url: `/${app}.webmanifest`, revision: buildId },
      ...['192', '512', 'maskable-512', 'apple-180'].map((icon) => ({
        url: `/icons/${app}-${icon}.png`,
        revision: buildId,
      })),
    ]),
    // The manuals open from the POS and the KDS without internet (RNF-21).
    ...['de', 'es'].flatMap((lang) =>
      ['', '/waiter', '/kitchen', '/manager', '/owner'].map((role) => ({
        url: `/help/${lang}${role}`,
        revision: buildId,
      })),
    ),
  ],
  disable: process.env.NODE_ENV === 'development',
});

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The Docker image runs the standalone server (deploy/Dockerfile); `next start` locally.
  ...(process.env.NEXT_OUTPUT === 'standalone' ? { output: 'standalone' as const } : {}),
  generateBuildId: () => buildId,
  env: { NEXT_PUBLIC_APP_VERSION: appVersion },
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

export default withSerwist(nextConfig);
