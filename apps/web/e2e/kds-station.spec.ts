import { expect, type Page, test } from '@playwright/test';
import { terminalPairingCode } from './hub-helpers';
import { closeSignInError, issuePairingCode, tapDigits, unlockPos } from './pos-helpers';

/**
 * A kitchen display without a fixed station asks before the PIN where the cook works (DEC-042),
 * and the POS sends each category to the station chosen there: drinks to the bar, desserts to
 * the pastry, dishes to the kitchen. Anyone with kitchen rights may work at any station.
 */
test.describe.configure({ mode: 'serial' });

async function pairSharedKds(page: Page) {
  const code = await issuePairingCode('D4');
  await page.goto('/kds');
  await page.getByLabel('Kopplungscode').fill(code);
  await page.getByRole('button', { name: 'Koppeln' }).click();
  await expect(page.getByRole('heading', { name: 'Welche Station?' })).toBeVisible({
    timeout: 30_000,
  });
}

async function chooseAndUnlock(page: Page, station: string) {
  await page.getByTestId('station-choice').filter({ hasText: station }).click();
  await expect(page.getByTestId('kds-pin-station')).toHaveText(station);
  await tapDigits(page, '5000');
  await page.getByRole('button', { name: 'Entsperren' }).click();
  await expect(page.getByTestId('kds-station')).toHaveText(station, { timeout: 15_000 });
}

/** Waits until the POS knows someone is at `station`, so nothing is sent around it. */
async function waitUntilAttended(pos: Page, station: string) {
  const notice = pos.getByTestId('routing-notice');
  await expect
    .poll(async () => ((await notice.count()) > 0 ? ((await notice.textContent()) ?? '') : ''), {
      timeout: 20_000,
    })
    .not.toMatch(new RegExp(`Niemand angemeldet:[^.]*\\b${station}\\b`));
}

/** Sends the pending lines; stations nobody attends go to their stand-in, as confirmed. */
async function send(pos: Page) {
  await pos.getByRole('button', { name: 'Senden', exact: true }).click();
  const confirm = pos.getByTestId('send-confirm');
  const asked = await confirm
    .waitFor({ state: 'visible', timeout: 3_000 })
    .then(() => true)
    .catch(() => false);
  if (asked) await confirm.getByRole('button', { name: /^Ja, an / }).click();
  await expect(pos.locator('[data-testid="line"][data-status="pending"]')).toHaveCount(0);
}

async function addProduct(pos: Page, category: string, product: string) {
  await pos.getByRole('button', { name: category, exact: true }).click();
  await pos.getByTestId('product').filter({ hasText: product }).first().click();
  await expect(pos.getByTestId('line').filter({ hasText: product }).last()).toBeVisible();
}

test('the display asks for the station; each category reaches the station chosen there', async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const posContext = await browser.newContext();
  const kdsContext = await browser.newContext();
  const pos = await posContext.newPage();
  const kds = await kdsContext.newPage();
  try {
    await pairSharedKds(kds);
    await expect(kds.getByTestId('station-choice')).toHaveText(['Küche', 'Bar', 'Patisserie']);

    // The station shows large above the PIN; it can still be changed before signing in.
    await kds.getByTestId('station-choice').filter({ hasText: 'Küche' }).click();
    await expect(kds.getByTestId('kds-pin-station')).toHaveText('Küche');
    await kds.getByTestId('other-station').click();
    await expect(kds.getByRole('heading', { name: 'Welche Station?' })).toBeVisible();

    // A waiter's PIN opens no station; the cook's opens the one chosen.
    await kds.getByTestId('station-choice').filter({ hasText: 'Bar' }).click();
    await tapDigits(kds, '4001');
    await kds.getByRole('button', { name: 'Entsperren' }).click();
    await expect(kds.getByText('Anna Huber hat keine Küchenberechtigung')).toBeVisible();
    await closeSignInError(kds);
    await expect(kds.getByTestId('kds-pin-station')).toHaveText('Bar');
    await tapDigits(kds, '5000');
    await kds.getByRole('button', { name: 'Entsperren' }).click();
    await expect(kds.getByTestId('kds-station')).toHaveText('Bar', { timeout: 15_000 });

    // A POS of its own; table 1 orders a dish, a dessert and a beer.
    const code = await terminalPairingCode('KS', { name: 'Kasse Stationen E2E', type: 'pos' });
    await pos.goto('/pos');
    await pos.getByLabel('Kopplungscode').fill(code);
    await pos.getByRole('button', { name: 'Koppeln' }).click();
    await expect(pos.getByRole('heading', { name: 'PIN eingeben' })).toBeVisible({
      timeout: 30_000,
    });
    await unlockPos(pos, '4001');
    await pos.getByTestId('table-1').click();
    await pos.getByRole('button', { name: 'Öffnen' }).click();
    await addProduct(pos, 'Hauptgerichte', 'Wiener Schnitzel mit Pommes frites');
    await addProduct(pos, 'Desserts', 'Zuger Kirschtorte');
    await addProduct(pos, 'Bier & Wein', 'Amber Bier 3.3 dl');
    await waitUntilAttended(pos, 'Bar');
    await send(pos);

    // The bar gets the beer, and only the beer.
    const atBar = kds.getByTestId('kds-ticket').filter({ hasText: 'Tisch 1' });
    await expect(atBar).toBeVisible({ timeout: 15_000 });
    await expect(atBar.getByTestId('kds-item')).toHaveCount(1);
    await expect(atBar.getByTestId('kds-item')).toContainText('Amber Bier');

    // Locked, the display asks again: now the pastry.
    await kds.getByRole('button', { name: 'Sperren' }).click();
    await expect(kds.getByRole('heading', { name: 'Welche Station?' })).toBeVisible();
    await chooseAndUnlock(kds, 'Patisserie');
    // Nothing of the bar shows at the pastry.
    await expect(kds.getByTestId('kds-item').filter({ hasText: 'Amber Bier' })).toHaveCount(0);

    // The table orders another dessert: it reaches the pastry chosen on the display.
    const desserts = kds.getByTestId('kds-item').filter({ hasText: 'Zuger Kirschtorte' });
    const before = await desserts.count();
    await addProduct(pos, 'Desserts', 'Zuger Kirschtorte');
    await waitUntilAttended(pos, 'Patisserie');
    await send(pos);
    await expect(desserts).toHaveCount(before + 1, { timeout: 15_000 });
    await expect(kds.getByTestId('kds-item').filter({ hasText: 'Wiener Schnitzel' })).toHaveCount(
      0,
    );
  } finally {
    await posContext.close();
    await kdsContext.close();
  }
});

test('the start menu speaks the language chosen there, and so does the pairing screen', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('start-kds')).toContainText('Küche (KDS)');
  await page.getByRole('combobox', { name: 'Sprache' }).click();
  await page.getByRole('option', { name: 'Español' }).click();
  await expect(page.getByTestId('start-kds')).toContainText('Cocina (KDS)');
  await expect(page.getByTestId('start-pos')).toContainText('Caja y servicio');

  await page.getByTestId('start-kds').click();
  await expect(page.getByLabel('Código de vinculación')).toBeVisible({ timeout: 30_000 });
});
