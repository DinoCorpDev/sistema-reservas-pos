import { DEMO_BACKOFFICE_PASSWORD, DEMO_USERS } from '@pos/db/testing';
import { devices, expect, test } from '@playwright/test';
import { terminalPairingCode } from './hub-helpers';
import { unlockPos } from './pos-helpers';

/**
 * A new waiter joins from their own phone (DEC-055): the manager shows a QR, the waiter enters
 * name and PIN on `/join`, the manager approves in Personal, and the PIN opens the till.
 */
test('a new waiter joins by QR, the manager approves, and the PIN opens the till', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const officeContext = await browser.newContext();
  const phoneContext = await browser.newContext({ ...devices['iPhone 13'] });
  const tillContext = await browser.newContext();
  try {
    const office = await officeContext.newPage();
    const admin = DEMO_USERS.find((user) => user.email?.startsWith('admin@'))!;
    await office.goto('/login');
    await office.getByLabel('E-Mail').fill(admin.email!);
    await office.getByLabel('Passwort').fill(DEMO_BACKOFFICE_PASSWORD);
    await office.getByRole('button', { name: 'Anmelden' }).click();
    await expect(office).toHaveURL(/\/backoffice/);

    // The QR with its code.
    await office.goto('/backoffice/users');
    await office.getByRole('button', { name: 'Kellner einladen' }).click();
    const code = (await office.getByTestId('invite-code').textContent())!.trim();
    expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);

    // On the phone: name, PIN twice, done.
    const phone = await phoneContext.newPage();
    await phone.goto(`/join?code=${code}`);
    await phone.getByLabel('Ihr Name').fill('Mia Neu');
    await phone.getByLabel('PIN', { exact: true }).fill('6235');
    await phone.getByLabel('PIN wiederholen').fill('6235');
    await phone.getByRole('button', { name: 'Beitreten' }).click();
    await expect(phone.getByTestId('join-done')).toContainText('Fertig, Mia Neu!');
    // Nothing scrolls sideways on a phone.
    const overflow = await phone.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    // The manager approves.
    await office.goto('/backoffice/users');
    await expect(office.getByTestId('registration-Mia Neu')).toBeVisible();
    await office.getByRole('button', { name: 'Freigeben: Mia Neu' }).click();
    await expect(office.getByTestId('pending-registrations')).toBeHidden();
    await expect(office.getByRole('cell', { name: /Mia Neu/ }).first()).toBeVisible();

    // The PIN opens a till paired afterwards.
    const till = await tillContext.newPage();
    const pairing = await terminalPairingCode('TJ', { name: 'Kasse Team E2E', type: 'pos' });
    await till.goto('/pos');
    await till.getByLabel('Kopplungscode').fill(pairing);
    await till.getByRole('button', { name: 'Koppeln' }).click();
    await expect(till.getByRole('heading', { name: 'PIN eingeben' })).toBeVisible({
      timeout: 30_000,
    });
    await unlockPos(till, '6235');
    await expect(till.getByTestId('pos-user')).toHaveText('Mia Neu');
  } finally {
    await officeContext.close();
    await phoneContext.close();
    await tillContext.close();
  }
});
