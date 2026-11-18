import { expect, test } from '@playwright/test';

test.describe('Smoke', () => {
  test('the home page links every operating surface', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Zitas POS' }),
    ).toBeVisible();
    for (const href of ['/pos', '/kds', '/backoffice']) {
      await expect(page.locator(`a[href="${href}"]`)).toBeVisible();
    }
  });

  test('/qr/demo-table renders', async ({ page }) => {
    await page.goto('/qr/demo-table');
    await expect(page.getByRole('heading', { level: 1, name: 'Menü' })).toBeVisible();
  });

  // The POS and the kitchen display are client apps that start by pairing (DEC-030).
  for (const path of ['/pos', '/kds']) {
    test(`${path} asks a new device to pair`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByText('Gerät koppeln')).toBeVisible();
      await expect(page.getByLabel('Kopplungscode')).toBeVisible();
    });
  }

  test('the backoffice requires signing in', async ({ page }) => {
    await page.goto('/backoffice');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Anmelden' })).toBeVisible();
  });

  test('touch targets are at least 44 px high (RNF-22)', async ({ page }) => {
    await page.goto('/login');
    const box = await page.getByRole('button', { name: 'Anmelden' }).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  });

  test('the public API reports a healthy database and documents itself', async ({ request }) => {
    const health = await request.get('/api/v1/health');
    expect(health.status()).toBe(200);
    expect(await health.json()).toMatchObject({ status: 'ok', checks: { database: 'ok' } });
    const doc = await request.get('/api/v1/openapi.json');
    expect(doc.status()).toBe(200);
    expect(((await doc.json()) as { openapi: string }).openapi).toBe('3.1.0');
  });
});
