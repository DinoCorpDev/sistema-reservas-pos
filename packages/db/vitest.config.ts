import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration tests against MySQL share the database: no parallelism across files.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
