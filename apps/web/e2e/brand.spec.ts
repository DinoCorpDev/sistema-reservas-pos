import { DEMO_BACKOFFICE_PASSWORD, DEMO_USERS } from '@pos/db/testing';
import { expect, type Page, test } from '@playwright/test';
import { terminalPairingCode } from './hub-helpers';

/**
 * The restaurant's brand (DEC-058): the owner sets colours, fonts and a logo under «Marke»; the
 * backoffice repaints and a till shows the logo on its PIN screen with the same colours. «Back to
 * Zitas» leaves everything as before (the other specs share this database).
 */

/** A 1 × 1 PNG: enough to be a logo. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const primaryOf = (page: Page) =>
  page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
  );

test('the owner gives the restaurant its brand and the till shows it', async ({ browser }) => {
  test.setTimeout(180_000);
  const officeContext = await browser.newContext();
  const tillContext = await browser.newContext();
  const office = await officeContext.newPage();
  try {
    const admin = DEMO_USERS.find((user) => user.email?.startsWith('admin@'))!;
    await office.goto('/login');
    await office.getByLabel('E-Mail').fill(admin.email!);
    await office.getByLabel('Passwort').fill(DEMO_BACKOFFICE_PASSWORD);
    await office.getByRole('button', { name: 'Anmelden' }).click();
    await expect(office).toHaveURL(/\/backoffice/);
    expect(await primaryOf(office)).toBe('#20b8bd');

    await office.goto('/backoffice/settings/brand');
    await expect(office.getByRole('heading', { name: 'Marke' })).toBeVisible();
    await office.getByTestId('brand-own-colors').click();
    await office.getByLabel('Hauptfarbe', { exact: true }).last().fill('#C8A76A');
    await office.getByLabel('Hintergrund', { exact: true }).last().fill('#F5EFE6');
    await office.getByTestId('brand-logo-light').setInputFiles({
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: PNG,
    });
    // The preview takes the colour before anything is saved.
    await expect(office.getByTestId('brand-preview-light')).toHaveCSS(
      'background-color',
      'rgb(245, 239, 230)',
    );
    await office.getByTestId('brand-save').click();
    await expect(office.getByText('Marke gespeichert')).toBeVisible();
    await expect.poll(() => primaryOf(office)).toBe('#c8a76a');
    await expect(office.getByRole('img', { name: 'Restaurant Demo Zürich' }).first()).toBeVisible();

    // A till paired now: the logo on the PIN screen and the brand's colours.
    const till = await tillContext.newPage();
    const code = await terminalPairingCode('TB', { name: 'Kasse Marke E2E', type: 'pos' });
    await till.goto('/pos');
    await till.getByLabel('Kopplungscode').fill(code);
    await till.getByRole('button', { name: 'Koppeln' }).click();
    await expect(till.getByRole('heading', { name: 'PIN eingeben' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(till.getByRole('img', { name: 'Restaurant Demo Zürich' }).first()).toBeVisible();
    await expect.poll(() => primaryOf(till)).toBe('#c8a76a');
  } finally {
    // Back to Zitas for the rest of the run.
    await office.goto('/backoffice/settings/brand');
    await office.getByRole('button', { name: 'Zurück zu Zitas' }).click();
    await expect.poll(() => primaryOf(office)).toBe('#20b8bd');
    await officeContext.close();
    await tillContext.close();
  }
});
