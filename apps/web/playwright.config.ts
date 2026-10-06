import { defineConfig, devices } from '@playwright/test';

const PORT = 3000;

/**
 * E2E del POS. En la Fase 2 se agregan los escenarios con la red apagada
 * (`page.context().setOffline(true)`), obligatorios en cada versión (RNF-19).
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'tablet', use: { ...devices['Galaxy Tab S4'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'pnpm start',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
