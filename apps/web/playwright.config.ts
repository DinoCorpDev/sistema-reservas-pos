import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;

/**
 * E2E against its own database (`<DATABASE_URL name>_e2e`), recreated and seeded by the global
 * setup, and its own server on port 3100, so the dev database and dev server are never touched.
 * Phase 2 adds the offline scenarios (`page.context().setOffline(true)`), mandatory per release (RNF-19).
 */
const devDatabase = new URL(process.env.DATABASE_URL ?? 'mysql://root@127.0.0.1:3310/pos_cloud');
const e2eDatabase = new URL(devDatabase);
e2eDatabase.pathname = `${devDatabase.pathname.replace(/\/$/, '')}_e2e`;
process.env.TEST_DATABASE_URL = e2eDatabase.toString();
// The LAN hub of the kitchen tests (Phase 3) gets its own empty database too.
const devHubDatabase = new URL(
  process.env.HUB_DATABASE_URL ?? 'mysql://root@127.0.0.1:3310/pos_hub',
);
const e2eHubDatabase = new URL(devHubDatabase);
e2eHubDatabase.pathname = `${devHubDatabase.pathname.replace(/\/$/, '')}_e2e`;
process.env.TEST_HUB_DATABASE_URL = e2eHubDatabase.toString();

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    locale: 'de-CH',
  },
  projects: [
    { name: 'tablet', use: { ...devices['Galaxy Tab S4'] }, testMatch: /smoke\.spec\.ts/ },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: `pnpm exec next start --port ${PORT}`,
    // Not /api/v1/health: the server starts before the global setup creates the E2E database.
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: { DATABASE_URL: e2eDatabase.toString() },
  },
});
