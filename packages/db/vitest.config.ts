import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Las pruebas de integración contra MySQL comparten la base: sin paralelismo entre archivos.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
