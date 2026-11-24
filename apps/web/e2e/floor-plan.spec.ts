import { DEMO_BACKOFFICE_PASSWORD, DEMO_USERS } from '@pos/db/testing';
import { expect, test } from '@playwright/test';
import { terminalPairingCode } from './hub-helpers';
import { unlockPos } from './pos-helpers';

/**
 * The floor plan (DEC-056): the owner moves and adds tables on the grid and saves; a till shows
 * them in the same places. Without an AI key the photo is offered but explained, not broken.
 */
test('the owner draws the floor plan and the till shows it the same way', async ({ browser }) => {
  test.setTimeout(180_000);
  const officeContext = await browser.newContext();
  const tillContext = await browser.newContext();
  try {
    const office = await officeContext.newPage();
    const admin = DEMO_USERS.find((user) => user.email?.startsWith('admin@'))!;
    await office.goto('/login');
    await office.getByLabel('E-Mail').fill(admin.email!);
    await office.getByLabel('Passwort').fill(DEMO_BACKOFFICE_PASSWORD);
    await office.getByRole('button', { name: 'Anmelden' }).click();
    await expect(office).toHaveURL(/\/backoffice/);

    await office.goto('/backoffice/floor');
    await office
      .getByRole('row', { name: /Terrasse/ })
      .getByRole('link', { name: 'Tischplan' })
      .click();
    await expect(office.getByRole('heading', { name: 'Tischplan: Terrasse' })).toBeVisible();
    await expect(office.getByRole('button', { name: 'Aus einem Foto erstellen' })).toBeDisabled();

    // T1 two rows down and one cell wider, with the keyboard; a new table where there is room.
    const t1 = office.getByTestId('plan-table-T1');
    await t1.focus();
    await office.keyboard.press('ArrowDown');
    await office.keyboard.press('ArrowDown');
    await office.keyboard.press('Shift+ArrowRight');
    await office.getByRole('button', { name: 'Tisch hinzufügen' }).click();
    await expect(office.getByTestId('plan-table-9')).toBeVisible();
    await office.getByRole('button', { name: 'Plan speichern' }).click();
    await expect(office.getByText('Tischplan gespeichert')).toBeVisible();
    await expect(office.getByRole('button', { name: 'Plan speichern' })).toBeDisabled();

    // A till paired now draws the same plan.
    const till = await tillContext.newPage();
    const code = await terminalPairingCode('TP', { name: 'Kasse Plan E2E', type: 'pos' });
    await till.goto('/pos');
    await till.getByLabel('Kopplungscode').fill(code);
    await till.getByRole('button', { name: 'Koppeln' }).click();
    await expect(till.getByRole('heading', { name: 'PIN eingeben' })).toBeVisible({
      timeout: 30_000,
    });
    await unlockPos(till, '3000');
    await till.getByRole('tab', { name: 'Terrasse' }).click();
    // The room (DEC-057): T1 two rows down and two cells wide, the new table in the room too.
    const placed = till.getByTestId('table-T1');
    await expect(placed).toHaveAttribute('data-pos', '0,2');
    await expect(placed).toHaveAttribute('data-size', '2x1');
    await expect(till.getByTestId('table-9')).toBeVisible();
    // A tap on the table in 3D opens it.
    await placed.click();
    await expect(till.getByRole('heading', { name: 'Tisch T1 öffnen' })).toBeVisible();
  } finally {
    await officeContext.close();
    await tillContext.close();
  }
});
