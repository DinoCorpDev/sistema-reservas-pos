import { defineConfig } from 'vitest/config';

// API integration tests: Hono `app.request` against the MySQL test database (@pos/db/testing).
export default defineConfig({
  test: {
    include: ['src/**/*.int.test.ts'],
    globalSetup: ['../db/src/testing.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: { AUTH_SECRET: process.env.AUTH_SECRET ?? 'test-secret-for-integration-tests-only-000000' },
  },
});
