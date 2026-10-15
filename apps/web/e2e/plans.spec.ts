import { DEMO_BACKOFFICE_PASSWORD, DEMO_USERS } from '@pos/db/testing';
import { expect, test } from '@playwright/test';
import { setDemoSubscription } from './pos-helpers';

/**
 * Plans (DEC-045): on the Café plan the demo restaurant cannot add a device beyond its plan; the
 * backoffice says why in German and «Mein Plan» shows the use against the plan. A late payment
 * shows a notice. Back to Pro afterwards, so the other specs keep their devices.
 */
test.describe.configure({ mode: 'serial' });

test.afterAll(async () => {
  await setDemoSubscription(null);
});

test('a café plan refuses one more device and «Mein Plan» shows why', async ({ page }) => {
  test.setTimeout(120_000);
  await setDemoSubscription('cafe', 'past_due');
  const admin = DEMO_USERS.find((user) => user.email?.startsWith('admin@'))!;
  await page.goto('/login');
  await page.getByLabel('E-Mail').fill(admin.email!);
  await page.getByLabel('Passwort').fill(DEMO_BACKOFFICE_PASSWORD);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/\/backoffice/);

  // The payment is late: the owner sees it on every page.
  await expect(page.getByText('Eine Zahlung für Ihr Abo ist ausstehend')).toBeVisible();

  await page.goto('/backoffice/devices?tab=terminals');
  await page.getByRole('button', { name: 'Neues Gerät' }).click();
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Kasse Plan');
  await page.getByRole('dialog').getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText(/Ihr Plan erlaubt höchstens 2 Geräte/)).toBeVisible();

  await page.goto('/backoffice/plan');
  await expect(page.getByTestId('my-plan-name')).toHaveText('Café');
  await expect(page.getByTestId('usage-devices')).toContainText(/\d+ von 2/);
  await expect(page.getByTestId('module-kds')).toHaveAttribute('data-included', 'false');
  await expect(page.getByTestId('module-kds')).toContainText('Im Plan Restaurant');
});
