import { defineConfig } from 'vitest/config';

// Hub integration tests: the cloud API in-process on its test database and the hub on its own
// (`<HUB_DATABASE_URL name>_test`), both real MySQL (src/test-setup.ts).
export default defineConfig({
  test: {
    include: ['src/**/*.int.test.ts'],
    globalSetup: ['src/test-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: {
      AUTH_SECRET: process.env.AUTH_SECRET ?? 'test-secret-for-integration-tests-only-000000',
    },
  },
});
