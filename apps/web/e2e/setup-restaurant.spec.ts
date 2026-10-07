import { DEMO_SUPPORT_STAFF } from '@pos/db/testing';
import { expect, type Page, test } from '@playwright/test';

/**
 * Phase 1 gate (RF-A11, Flujo 7): a new restaurant is set up completely from the backoffice,
 * without touching code. DINOLABS support creates the organization; the owner signs in, sets
 * her own password, configures floor, devices, staff PIN and catalog until the setup checklist
 * is complete, activates operation and switches her UI language (RF-A08).
 */
test.describe.configure({ mode: 'serial' });

const OWNER = {
  name: 'Petra Inhaberin',
  email: 'petra@gasthaus-baeren.test',
  password: 'baeren-owner-pass-2026',
  pin: '4711',
};

const saved = (page: Page, text = 'Gespeichert') =>
  expect(page.getByText(text, { exact: true }).first()).toBeVisible();

async function signIn(page: Page, path: string, email: string, password: string) {
  await page.goto(path);
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort').fill(password);
  await page.getByRole('button', { name: 'Anmelden' }).click();
}

test('a new restaurant is set up from the backoffice alone and goes live', async ({ page }) => {
  test.setTimeout(240_000);

  // ── 1. DINOLABS support creates the restaurant (Flujo 7.1, DEC-017) ──────
  await signIn(page, '/support/login', DEMO_SUPPORT_STAFF.email, DEMO_SUPPORT_STAFF.password);
  await expect(page).toHaveURL(/\/support$/);
  await page.getByRole('button', { name: 'Neues Restaurant' }).click();
  const wizard = page.getByRole('dialog');

  await wizard.getByLabel('Name der Organisation').fill('Gasthaus Bären');
  await wizard.getByLabel('Firma (Rechtsträger)').fill('Gasthaus Bären GmbH');
  await wizard.getByRole('button', { name: 'Weiter' }).click();

  await wizard.getByLabel('Name des Standorts').fill('Gasthaus Bären Bern');
  await wizard.getByLabel('Firma des Standorts').fill('Gasthaus Bären GmbH');
  await wizard.getByLabel('Strasse und Nr.').fill('Marktgasse 10');
  await wizard.getByLabel('PLZ').fill('3011');
  await wizard.getByLabel('Ort', { exact: true }).fill('Bern');
  await wizard.getByLabel('Kanton').fill('BE');
  await wizard.getByPlaceholder('CHE-123.456.789').fill('CHE-109.322.551');
  await wizard.getByRole('checkbox', { name: 'Französisch' }).check();
  await wizard.getByRole('button', { name: 'Weiter' }).click();

  await wizard.getByLabel('Name', { exact: true }).fill(OWNER.name);
  await wizard.getByLabel('E-Mail für die Anmeldung').fill(OWNER.email);
  await wizard.getByRole('button', { name: 'Weiter' }).click();
  await wizard.getByRole('button', { name: 'Restaurant anlegen' }).click();

  await expect(wizard.getByRole('heading', { name: 'Restaurant angelegt' })).toBeVisible();
  const temporaryPassword = (await wizard.locator('code').first().innerText()).trim();
  expect(temporaryPassword.length).toBeGreaterThanOrEqual(12);
  await wizard.getByRole('button', { name: 'Fertig' }).click();
  await page.getByRole('button', { name: 'Abmelden' }).click();
  await expect(page).toHaveURL(/\/support\/login$/);

  // ── 2. The owner signs in and must choose her own password ───────────────
  await signIn(page, '/login', OWNER.email, temporaryPassword);
  await expect(page).toHaveURL(/\/backoffice\/password$/);
  await page.getByLabel('Aktuelles Passwort').fill(temporaryPassword);
  await page.getByLabel('Neues Passwort', { exact: true }).fill(OWNER.password);
  await page.getByLabel('Neues Passwort wiederholen').fill(OWNER.password);
  await page.getByRole('button', { name: 'Passwort ändern' }).click();
  await expect(page).toHaveURL(/\/backoffice$/);
  await expect(page.getByText('7 von 14 erledigt')).toBeVisible();

  // ── 3. Floor: an area and a table (RF-A03) ──────────────────────────────
  await page.goto('/backoffice/floor');
  await page.getByRole('button', { name: 'Neuer Bereich' }).click();
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Gaststube');
  await page.getByRole('dialog').getByRole('button', { name: 'Speichern' }).click();
  await saved(page);
  await page.getByRole('button', { name: 'Neuer Tisch' }).click();
  await page.getByRole('dialog').getByLabel('Bezeichnung').fill('1');
  await page.getByRole('dialog').getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  // ── 4. Devices: kitchen station, receipt printer, POS terminal ──────────
  await page.goto('/backoffice/devices?tab=stations');
  await page.getByRole('button', { name: 'Neue Station' }).click();
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Küche');
  await page.getByRole('dialog').getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  await page.goto('/backoffice/devices?tab=printers');
  await page.getByRole('button', { name: 'Neuer Drucker' }).click();
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Bondrucker Kasse');
  await page.getByRole('dialog').getByLabel('IP-Adresse oder Hostname').fill('192.168.1.50');
  await page.getByRole('dialog').getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  await page.goto('/backoffice/devices?tab=terminals');
  await page.getByRole('button', { name: 'Neues Gerät' }).click();
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Kasse 1');
  await page.getByRole('dialog').getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  // ── 5. Staff: the owner sets her POS PIN (RF-A06) ───────────────────────
  await page.goto('/backoffice/users');
  await page
    .getByRole('row')
    .filter({ hasText: OWNER.name })
    .getByRole('button', { name: 'PIN setzen' })
    .click();
  await page.getByRole('dialog').getByLabel('Neue PIN').fill(OWNER.pin);
  await page.getByRole('dialog').getByRole('button', { name: 'PIN setzen' }).click();
  await saved(page, 'PIN gespeichert.');

  // ── 6. Catalog: category and product with allergens, translation, station
  await page.goto('/backoffice/catalog/categories');
  await page.getByRole('button', { name: 'Neue Kategorie' }).click();
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Hauptgerichte');
  await page.getByRole('dialog').getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  await page.goto('/backoffice/catalog');
  await page.getByRole('button', { name: 'Neues Produkt' }).click();
  const newProduct = page.getByRole('dialog');
  await newProduct.getByLabel('Name', { exact: true }).fill('Berner Rösti');
  await newProduct.getByLabel('Preis').fill('24.50');
  await newProduct.getByLabel('Preis').blur();
  await newProduct.getByRole('button', { name: 'Erstellen' }).click();
  await expect(page).toHaveURL(/\/backoffice\/catalog\/products\/[0-9a-f-]{36}/);

  await page.getByRole('tab', { name: /Allergene & Herkunft/ }).click();
  await page
    .getByRole('radiogroup', { name: 'Milch (inkl. Laktose)' })
    .getByRole('radio', { name: 'Enthält', exact: true })
    .click();
  await page.getByRole('checkbox', { name: 'Allergene geprüft und vollständig' }).check();
  await page.getByRole('tabpanel').getByRole('button', { name: 'Speichern' }).first().click();
  await saved(page);

  await page.getByRole('tab', { name: 'Übersetzungen' }).click();
  await page.locator('#product-translation-fr-name').fill('Rösti bernois');
  await page.getByRole('tabpanel').getByRole('button', { name: 'Speichern' }).first().click();
  await saved(page);

  await page.getByRole('tab', { name: 'Stationen' }).click();
  await page.getByRole('checkbox', { name: 'Küche' }).check();
  await page.getByRole('tabpanel').getByRole('button', { name: 'Speichern' }).first().click();
  await saved(page);

  // ── 7. The checklist is complete; the owner activates operation (RF-A11) ─
  await page.goto('/backoffice');
  await expect(page.getByText('14 von 14 erledigt')).toBeVisible();
  await page.getByRole('button', { name: 'Betrieb aktivieren' }).click();
  await expect(page.getByText(/Betrieb aktiv seit \d{2}\.\d{2}\.\d{4}/)).toBeVisible();

  // ── 8. Her own UI language, independent of the location (RF-A08) ────────
  await page.getByRole('combobox', { name: 'Sprache' }).click();
  await page.getByRole('option', { name: 'Français' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page.getByText('14 sur 14 terminés')).toBeVisible();
  await expect(page.getByText(/Exploitation active depuis le \d{2}\.\d{2}\.\d{4}/)).toBeVisible();

  // The choice is stored on her user, so it survives a reload.
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');

  await page.getByRole('combobox', { name: 'Langue' }).click();
  await page.getByRole('option', { name: 'Italiano' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'it');
  await expect(page.getByText('14 di 14 completati')).toBeVisible();
});
