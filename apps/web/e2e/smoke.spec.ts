import { expect, test } from '@playwright/test';

test.describe('Phase 0 smoke', () => {
  test('the home page links every operating surface', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Sistema Reservas POS' }),
    ).toBeVisible();
    for (const href of ['/pos', '/kds', '/backoffice']) {
      await expect(page.locator(`a[href="${href}"]`)).toBeVisible();
    }
  });

  for (const [path, heading] of [
    ['/pos', 'Kasse & Service'],
    ['/kds', 'Küche (KDS)'],
    ['/backoffice', 'Backoffice'],
    ['/qr/demo-table', 'Menü'],
  ] as const) {
    test(`${path} renders`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    });
  }

  test('touch targets are at least 44 px high (RNF-22)', async ({ page }) => {
    await page.goto('/pos');
    const box = await page.getByRole('link', { name: 'Übersicht' }).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  });

  test('the public API reports a healthy database', async ({ request }) => {
    const response = await request.get('/api/v1/health');
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok', checks: { database: 'ok' } });
  });
});
