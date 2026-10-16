import { DEMO_BACKOFFICE_PASSWORD, DEMO_USERS } from '@pos/db/testing';
import { expect, test } from '@playwright/test';
import { openShift, unlockPos } from './pos-helpers';

/**
 * Training mode (RF-F22): the owner creates the practice copy in «Mein Plan» and pairs a till
 * from there. The till shows the orange band, opens with the real PIN, and its receipt says it
 * is not valid. The practice copy is an organization of its own, so the other specs (which find
 * the demo terminals by organization) are not affected.
 */
test('a practice till: orange band, the real PIN and a receipt marked as not valid', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  const admin = DEMO_USERS.find((user) => user.email?.startsWith('admin@'))!;
  await page.goto('/login');
  await page.getByLabel('E-Mail').fill(admin.email!);
  await page.getByLabel('Passwort').fill(DEMO_BACKOFFICE_PASSWORD);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/\/backoffice/);

  await page.goto('/backoffice/plan');
  const card = page.getByTestId('training-card');
  await card.getByRole('button', { name: 'Übungsbetrieb erstellen' }).click();
  const till = card.getByTestId('training-terminal').filter({ hasText: 'Kasse 1' });
  await expect(till).toBeVisible({ timeout: 30_000 });
  await till.getByRole('button', { name: 'Koppeln' }).click();
  const code = (await page.getByTestId('pairing-code').innerText()).trim();

  // The practice till is another device: its own browser context.
  const pos = await browser.newPage();
  await pos.goto('/pos');
  await pos.getByLabel('Kopplungscode').fill(code);
  await pos.getByRole('button', { name: 'Koppeln' }).click();
  await expect(pos.getByRole('heading', { name: 'PIN eingeben' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(pos.getByTestId('training-band')).toHaveText(/Übungsmodus/i);

  await unlockPos(pos, '4001');
  await expect(pos.getByTestId('training-band')).toBeVisible();
  await openShift(pos);
  await pos.getByRole('button', { name: 'Theke' }).click();
  await pos.getByRole('button', { name: 'Neue Bestellung' }).click();
  await pos.getByRole('button', { name: 'Vorspeisen', exact: true }).click();
  await pos.getByTestId('product').filter({ hasText: 'Tomatensuppe' }).first().click();
  await pos.getByRole('button', { name: 'Bezahlen' }).click();
  await pos.getByRole('button', { name: 'Bar', exact: true }).click();
  await pos.getByLabel('Gegeben').fill('20');
  await pos.getByRole('button', { name: 'Zahlung bestätigen' }).click();
  await expect(pos.getByTestId('receipt-text')).toContainText('ÜBUNG — KEIN GÜLTIGER BELEG');

  // Back in the real backoffice the practice till shows as paired.
  await page.getByRole('button', { name: 'Fertig' }).click();
  await page.reload();
  await expect(till.getByText('Gekoppelt')).toBeVisible();
  await pos.close();
});
