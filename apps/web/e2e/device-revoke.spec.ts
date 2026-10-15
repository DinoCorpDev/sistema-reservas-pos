import { DEMO_BACKOFFICE_PASSWORD, DEMO_USERS } from '@pos/db/testing';
import { expect, test } from '@playwright/test';
import { terminalPairingCode } from './hub-helpers';
import { unlockPos } from './pos-helpers';

/**
 * A device deactivated in the backoffice stops working as soon as the cloud tells it (RF-A12,
 * DEC-035): no tables, no orders and no kitchen board, not even after a reload, until it is
 * paired again with the new code the backoffice shows when it is reactivated. Its orders are
 * still there afterwards. The POS and the kitchen display share the same runtime.
 */
const NAME = 'Kasse Sperre E2E';
const KDS_NAME = 'KDS Sperre E2E';

test('a deactivated POS or KDS locks itself and comes back with a new code', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const posContext = await browser.newContext();
  const kdsContext = await browser.newContext();
  const officeContext = await browser.newContext();
  const pos = await posContext.newPage();
  const kds = await kdsContext.newPage();
  const office = await officeContext.newPage();
  try {
    // A kitchen display of its own ("DR"), paired; without a fixed station it asks for one
    // before the PIN (DEC-042).
    const kdsCode = await terminalPairingCode('DR', { name: KDS_NAME, type: 'kds' });
    await kds.goto('/kds');
    await kds.getByLabel('Kopplungscode').fill(kdsCode);
    await kds.getByRole('button', { name: 'Koppeln' }).click();
    await expect(kds.getByRole('heading', { name: 'Welche Station?' })).toBeVisible({
      timeout: 30_000,
    });

    // A POS of its own ("KR"), with an order at table 8 that reached the cloud.
    const code = await terminalPairingCode('KR', { name: NAME, type: 'pos' });
    await pos.goto('/pos');
    await pos.getByLabel('Kopplungscode').fill(code);
    await pos.getByRole('button', { name: 'Koppeln' }).click();
    await expect(pos.getByRole('heading', { name: 'PIN eingeben' })).toBeVisible({
      timeout: 30_000,
    });
    await unlockPos(pos, '4001');
    await pos.getByTestId('table-8').click();
    await pos.getByRole('button', { name: 'Öffnen' }).click();
    await pos.getByRole('button', { name: 'Vorspeisen', exact: true }).click();
    await pos.getByTestId('product').filter({ hasText: 'Tomatensuppe' }).first().click();
    await expect(pos.getByTestId('line')).toHaveCount(1);
    await expect(pos.getByTestId('sync-pending')).toHaveAttribute('data-pending', '0', {
      timeout: 30_000,
    });

    // The manager deactivates it in the backoffice.
    const admin = DEMO_USERS.find((user) => user.email?.startsWith('admin@'))!;
    await office.goto('/login');
    await office.getByLabel('E-Mail').fill(admin.email!);
    await office.getByLabel('Passwort').fill(DEMO_BACKOFFICE_PASSWORD);
    await office.getByRole('button', { name: 'Anmelden' }).click();
    await expect(office).toHaveURL(/\/backoffice/);
    await office.goto('/backoffice/devices');
    const row = office.getByRole('row').filter({ hasText: NAME });
    await row.getByRole('button', { name: 'Gerät deaktivieren' }).click();
    await office.getByRole('button', { name: 'Deaktivieren', exact: true }).click();

    // The POS locks itself: no tables, no header, and a reload does not bring them back.
    const revoked = pos.getByTestId('device-revoked');
    await expect(revoked).toContainText('Gerät entkoppelt', { timeout: 15_000 });
    await expect(revoked).toContainText(NAME);
    await expect(pos.getByRole('navigation', { name: 'Kasse' })).toHaveCount(0);
    await pos.reload();
    await expect(pos.getByTestId('device-revoked')).toBeVisible();
    await expect(pos.getByTestId('table-8')).toHaveCount(0);

    // The same for the kitchen display.
    await office
      .getByRole('row')
      .filter({ hasText: KDS_NAME })
      .getByRole('button', { name: 'Gerät deaktivieren' })
      .click();
    await office.getByRole('button', { name: 'Deaktivieren', exact: true }).click();
    await expect(kds.getByTestId('device-revoked')).toContainText('Gerät entkoppelt', {
      timeout: 15_000,
    });
    await expect(kds.getByRole('heading', { name: 'Welche Station?' })).toHaveCount(0);

    // Reactivating it shows the new pairing code at once.
    await row.getByRole('button', { name: 'Gerät aktivieren' }).click();
    await office.getByRole('button', { name: 'Aktivieren', exact: true }).click();
    const pairing = office.getByRole('dialog', { name: `Kopplungscode für ${NAME}` });
    await expect(pairing).toBeVisible();
    const newCode = /[A-Z0-9]{4}-[A-Z0-9]{4}/.exec((await pairing.textContent()) ?? '')![0];

    // With it the POS is back, with its order.
    await pos.getByLabel('Kopplungscode').fill(newCode);
    await pos.getByRole('button', { name: 'Koppeln' }).click();
    await expect(pos.getByRole('heading', { name: 'PIN eingeben' })).toBeVisible({
      timeout: 30_000,
    });
    await unlockPos(pos, '4001');
    await expect(pos.getByTestId('table-8')).toHaveAttribute('data-state', 'awaiting_order');
  } finally {
    await posContext.close();
    await kdsContext.close();
    await officeContext.close();
  }
});
