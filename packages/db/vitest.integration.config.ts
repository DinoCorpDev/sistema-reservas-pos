import { defineConfig } from 'vitest/config';

// Integration tests against MySQL: their own database, recreated once per run (src/testing.ts).
export default defineConfig({
  test: {
    include: ['src/**/*.int.test.ts'],
    globalSetup: ['./src/testing.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
