import { DEMO_BACKOFFICE_PASSWORD, DEMO_USERS } from '@pos/db/testing';
import { expect, test } from '@playwright/test';
import { terminalPairingCode } from './hub-helpers';
import { closeSignInError, tapDigits, unlockPos } from './pos-helpers';

/**
 * A waiter's own phone (DEC-036): the cashier POS shows a QR, the phone opens it and takes the
 * waiter's PIN, and from then on it opens only with that PIN. Signing out refuses while anything
 * the phone did has not reached the cloud, and afterwards the phone is back at the pairing screen
 * with nothing of the shift left. The backoffice shows whose phone it is.
 */
test('a waiter pairs their own phone at the cashier POS and signs out at the end', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const kasseContext = await browser.newContext();
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const officeContext = await browser.newContext();
  const kasse = await kasseContext.newPage();
  const phone = await phoneContext.newPage();
  const office = await officeContext.newPage();
  try {
    // The cashier POS ("KP"), unlocked by Lea, shows the code for waiters' phones.
    const kasseCode = await terminalPairingCode('KP', { name: 'Kasse Telefon E2E', type: 'pos' });
    await kasse.goto('/pos');
    await kasse.getByLabel('Kopplungscode').fill(kasseCode);
    await kasse.getByRole('button', { name: 'Koppeln' }).click();
    await expect(kasse.getByRole('heading', { name: 'PIN eingeben' })).toBeVisible({
      timeout: 30_000,
    });
    await unlockPos(kasse, '3000');
    await kasse.getByRole('button', { name: 'Service-Telefon koppeln' }).click();
    const dialog = kasse.getByRole('dialog', { name: 'Service-Telefon koppeln' });
    await expect(
      dialog.getByRole('img', { name: 'QR-Code zum Koppeln eines Telefons' }),
    ).toBeVisible({ timeout: 15_000 });
    const code = (await dialog.getByTestId('phone-code').textContent())!.trim();
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    // The phone opens the QR's address: straight to the waiter's PIN, then the floor as Anna.
    await phone.goto(`/pos?phone=${code}`);
    await expect(phone.getByTestId('phone-pin-step')).toBeVisible({ timeout: 30_000 });
    expect(new URL(phone.url()).search).toBe('');
    await tapDigits(phone, '4001');
    await phone.getByRole('button', { name: 'Koppeln' }).click();
    await expect(phone.getByTestId('pos-user')).toHaveText('Anna Huber', { timeout: 30_000 });

    // Locked, the phone says whose it is. It keeps no other waiter's PIN, and a manager's PIN
    // (kept for approvals) does not open it either.
    await phone.getByRole('button', { name: 'Sperren' }).click();
    await expect(phone.getByText('Telefon von Anna Huber')).toBeVisible();
    await tapDigits(phone, '4002');
    await phone.getByRole('button', { name: 'Entsperren' }).click();
    await expect(phone.getByText('Falsche PIN')).toBeVisible();
    await closeSignInError(phone);
    await tapDigits(phone, '2000');
    await phone.getByRole('button', { name: 'Entsperren' }).click();
    await expect(phone.getByText('Dieses Telefon gehört Anna Huber')).toBeVisible();
    await closeSignInError(phone);
    await unlockPos(phone, '4001');

    // Without network, signing out refuses: the new order has not reached the cloud.
    await phoneContext.setOffline(true);
    await phone.getByTestId('table-6').click();
    await phone.getByRole('button', { name: 'Öffnen' }).click();
    await phone.getByRole('button', { name: 'Vorspeisen', exact: true }).click();
    await phone.getByTestId('product').filter({ hasText: 'Tomatensuppe' }).first().click();
    await expect(phone.getByTestId('line')).toHaveCount(1);
    await phone.getByRole('button', { name: 'Abmelden' }).click();
    await phone.getByRole('dialog').getByRole('button', { name: 'Abmelden' }).click();
    await expect(phone.getByText('noch nicht in der Cloud')).toBeVisible({ timeout: 15_000 });
    await expect(phone.getByTestId('pos-user')).toHaveText('Anna Huber');

    // Back online: it signs out, unpairs and starts over at the pairing screen.
    await phoneContext.setOffline(false);
    await expect(phone.getByTestId('sync-pending')).toHaveAttribute('data-pending', '0', {
      timeout: 30_000,
    });
    await phone.getByRole('button', { name: 'Abmelden' }).click();
    // The phone reloads itself once it has forgotten the shift.
    await Promise.all([
      phone.waitForEvent('load', { timeout: 30_000 }),
      phone.getByRole('dialog').getByRole('button', { name: 'Abmelden' }).click(),
    ]);
    await expect(phone.getByLabel('Kopplungscode')).toBeVisible({ timeout: 30_000 });
    await phone.reload();
    await expect(phone.getByLabel('Kopplungscode')).toBeVisible({ timeout: 30_000 });
    await expect(phone.getByTestId('table-6')).toHaveCount(0);

    // The backoffice shows Anna's phone, no longer paired.
    const admin = DEMO_USERS.find((user) => user.email?.startsWith('admin@'))!;
    await office.goto('/login');
    await office.getByLabel('E-Mail').fill(admin.email!);
    await office.getByLabel('Passwort').fill(DEMO_BACKOFFICE_PASSWORD);
    await office.getByRole('button', { name: 'Anmelden' }).click();
    await expect(office).toHaveURL(/\/backoffice/);
    await office.goto('/backoffice/devices');
    const row = office.getByTestId('phone-row').filter({ hasText: 'Anna Huber' });
    await expect(row).toContainText('Nicht gekoppelt');
  } finally {
    await kasseContext.close();
    await phoneContext.close();
    await officeContext.close();
  }
});
