import { expect, type Page, test } from '@playwright/test';
import { cloudState, pairPos, posLocalData, unlockPos } from './pos-helpers';

/**
 * Phase 2 gate (prompt maestro §6, RNF-02, RNF-03, RF-C18): table → order → kitchen → payment →
 * receipt works with the internet off, survives a reload, and syncs without duplicates when
 * the connection returns. The test proves itself: the service worker controls the page before
 * going offline, the cloud has nothing while offline, and a second delivery changes nothing.
 */
test.describe.configure({ mode: 'serial' });

async function category(page: Page, name: string) {
  await page.getByRole('button', { name, exact: true }).click();
}

async function product(page: Page, name: string) {
  await page.getByTestId('product').filter({ hasText: name }).first().click();
}

test('the full service works offline and syncs exactly once', async ({ page, context }) => {
  test.setTimeout(240_000);
  await pairPos(page, 'H1');
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), {
      timeout: 30_000,
    })
    .toBe(true);
  const before = await cloudState('H1');

  // ── Internet off ─────────────────────────────────────────────────────────
  await context.setOffline(true);
  await unlockPos(page, '4001');
  await expect(page.getByTestId('sync-level')).toHaveAttribute('data-level', 'standalone');

  // Open table 3 for two guests (RF-C02).
  await page.getByTestId('table-3').click();
  await expect(page.getByRole('heading', { name: 'Tisch 3 öffnen' })).toBeVisible();
  await page.getByRole('button', { name: 'Öffnen' }).click();
  // Numbered with the terminal prefix: the authority is not reachable (RN-16).
  await expect(page.getByTestId('order-number')).toContainText('H1-0001');

  // Two soups (course 1): the second tap raises the quantity. One tap < 200 ms (RNF-06).
  await category(page, 'Vorspeisen');
  const elapsed = await page.evaluate(async () => {
    const button = [...document.querySelectorAll<HTMLElement>('[data-testid="product"]')].find(
      (el) => el.textContent?.includes('Bündner Gerstensuppe'),
    )!;
    const lines = () => document.querySelectorAll('[data-testid="line"]').length;
    const start = performance.now();
    const count = lines();
    button.click();
    while (lines() === count && performance.now() - start < 2_000) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return performance.now() - start;
  });
  expect(elapsed).toBeLessThan(200);
  await product(page, 'Bündner Gerstensuppe');
  await expect(page.getByTestId('line')).toHaveCount(1);

  // A 5 dl beer: a variant in the product dialog.
  await category(page, 'Bier & Wein');
  await product(page, 'Lager vom Fass');
  const beer = page.getByRole('dialog');
  await beer.getByRole('radio', { name: /^5 dl/ }).click();
  await beer.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(page.getByTestId('line')).toHaveCount(2);

  // Send course 1 and the drinks (RF-C09).
  await page.getByRole('button', { name: 'Senden', exact: true }).click();
  await expect(page.locator('[data-testid="line"][data-status="pending"]')).toHaveCount(0);

  // The main course later, with doneness and a side; then march course 2 (RF-C08, RF-C09).
  await category(page, 'Hauptgerichte');
  await product(page, 'Rindsfilet mit Kräuterbutter');
  const main = page.getByRole('dialog');
  await main.getByRole('radio', { name: /^Medium/ }).click();
  await main.getByText('Rösti', { exact: true }).click();
  await main.getByLabel('Notiz').fill('Sauce separat');
  await main.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(page.getByTestId('line')).toHaveCount(3);
  await page.getByRole('button', { name: 'Gang 2 schicken' }).click();
  await expect(page.locator('[data-testid="line"][data-status="pending"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Serviert', exact: true }).click();
  await expect(page.locator('[data-testid="line"][data-status="served"]')).toHaveCount(3);
  // 2 × 11.00 + 7.50 + 52.00 + 3.00 = 84.50
  await expect(page.getByTestId('order-total')).toContainText('84.50');

  // ── Mixed payment: card with a tip on the terminal, then cash (RF-D02…D04, D06) ──
  await page.getByRole('button', { name: 'Bezahlen' }).click();
  await expect(page.getByTestId('payment-balance')).toContainText('84.50');
  await page.getByLabel('Betrag', { exact: true }).fill('50.02');
  await page.getByRole('button', { name: 'Karte' }).click();
  await page.getByLabel('Bestätigter Betrag').fill('52.02');
  await page.getByRole('button', { name: 'Zahlung bestätigen' }).click();
  const firstReceipt = page.getByTestId('receipt-text');
  await expect(firstReceipt).toContainText('CHE-');
  await expect(firstReceipt).toContainText('MWST');
  await expect(firstReceipt).toContainText('8.1%');
  await expect(firstReceipt).toContainText('Trinkgeld');
  await page.getByRole('button', { name: 'Weiter kassieren' }).click();

  await expect(page.getByTestId('payment-balance')).toContainText('34.48');
  await page.getByRole('button', { name: 'Bar', exact: true }).click();
  await page.getByLabel('Gegeben').fill('50');
  // Cash is rounded to 0.05 (RN-06): 34.48 → 34.50, change 15.50.
  await expect(page.getByTestId('payment-change')).toContainText('15.50');
  await page.getByRole('button', { name: 'Zahlung bestätigen' }).click();
  const secondReceipt = page.getByTestId('receipt-text');
  await expect(secondReceipt).toContainText('Rundung');
  await expect(secondReceipt).toContainText('Bereits bezahlt');
  await page.getByRole('button', { name: 'Fertig' }).click();

  // Served and paid: the order closed by itself and the table is free (RN-12).
  await expect(page.getByTestId('table-3')).toHaveAttribute('data-state', 'free');
  await expect(page.getByTestId('sync-pending')).not.toHaveAttribute('data-pending', '0');

  // ── A reload without network keeps everything (RNF-02) ──────────────────
  await page.reload();
  await unlockPos(page, '4001');
  await expect(page.getByTestId('table-3')).toHaveAttribute('data-state', 'free');
  await page
    .getByRole('navigation', { name: 'Kasse' })
    .getByRole('button', { name: 'Bestellungen' })
    .click();
  await page.getByRole('tab', { name: 'Heute abgeschlossen' }).click();
  await expect(page.getByTestId('closed-order-row')).toHaveCount(1);

  // Nothing reached the cloud while offline.
  const offline = await cloudState('H1');
  expect(offline.operations.length).toBe(before.operations.length);
  expect(offline.orders).toHaveLength(0);

  // ── Internet back: the queue empties by itself (RNF-03) ─────────────────
  await context.setOffline(false);
  await expect(page.getByTestId('sync-pending')).toHaveAttribute('data-pending', '0', {
    timeout: 60_000,
  });
  await expect(page.getByTestId('sync-level')).toHaveAttribute('data-level', 'cloud');

  const synced = await cloudState('H1');
  expect(synced.orders).toHaveLength(1);
  expect(synced.orders[0]).toMatchObject({
    displayNumber: 'H1-0001',
    status: 'closed',
    paymentStatus: 'paid',
    totalRappen: 8450,
    paidTotalRappen: 8450,
    tipTotalRappen: 200,
  });
  expect(synced.payments).toHaveLength(2);
  expect(synced.payments.map((p) => p.roundingRappen).sort()).toEqual([0, 2]);
  expect(synced.receipts).toHaveLength(2);

  // Sending everything again changes nothing: every operation is a duplicate.
  const local = await posLocalData(page);
  const response = await page.request.post('/api/v1/sync/push', {
    headers: { 'x-terminal-token': local.deviceToken },
    data: { operations: local.ops },
  });
  const { results } = (await response.json()) as { results: { status: string }[] };
  expect(results.length).toBe(local.ops.length);
  expect(results.every((r) => r.status === 'duplicate')).toBe(true);
  const again = await cloudState('H1');
  expect(again.operations.length).toBe(synced.operations.length);
  expect(again.payments).toHaveLength(2);
  expect(again.receipts).toHaveLength(2);
});

test('a hanging WAN never blocks the POS (docs/SYNC.md §1)', async ({ page }) => {
  test.setTimeout(180_000);
  await pairPos(page, 'H2');
  // Anna (German); Luca (4002) would see the menu in Italian (RF-A08).
  await unlockPos(page, '4001');
  await expect(page.getByTestId('sync-level')).toHaveAttribute('data-level', 'cloud');

  // The cloud stops answering: requests hang instead of failing.
  await page.route('**/api/v1/**', () => undefined);
  await expect(page.getByTestId('sync-level')).toHaveAttribute('data-level', 'standalone', {
    timeout: 30_000,
  });
  await page.getByTestId('table-5').click();
  await page.getByRole('button', { name: 'Öffnen' }).click();
  await expect(page.getByTestId('order-number')).toContainText('H2-');
  await category(page, 'Vorspeisen');
  await product(page, 'Tomatensuppe');
  await expect(page.getByTestId('line')).toHaveCount(1);
  await expect(page.getByTestId('sync-pending')).not.toHaveAttribute('data-pending', '0');

  await page.unroute('**/api/v1/**');
  await expect(page.getByTestId('sync-pending')).toHaveAttribute('data-pending', '0', {
    timeout: 60_000,
  });
  const synced = await cloudState('H2');
  expect(synced.orders).toHaveLength(1);
});
