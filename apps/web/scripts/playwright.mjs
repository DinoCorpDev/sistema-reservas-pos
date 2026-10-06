// Runs the Playwright CLI with the monorepo .env loaded, so PLAYWRIGHT_BROWSERS_PATH (browsers
// kept on a drive with space, DEC-013) applies to both `install` and `test`. Playwright reads that
// variable when it loads, so it has to be set before the CLI process starts.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '../../..');
const envFile = resolve(repoRoot, '.env');
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
if (browsersPath && browsersPath !== '0' && !isAbsolute(browsersPath)) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = resolve(repoRoot, browsersPath);
}

const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
});
process.exit(result.status ?? 1);
