import { DEMO_BACKOFFICE_PASSWORD, DEMO_USERS } from '@pos/db/testing';
import { expect, type Page, test } from '@playwright/test';
import { terminalPairingCode } from './hub-helpers';
import { unlockPos } from './pos-helpers';

/**
 * Working time (RF-A09, DEC-054): after the PIN the till offers to clock in without blocking the
 * screen; "Ausstempeln" ends the shift and locks; the manager sees both in "Arbeitszeit".
 */

/** The row of Lea's entry in the timesheet, read again until the cloud has the operation. */
async function expectLeaStatus(office: Page, status: string) {
  await expect(async () => {
    await office.goto('/backoffice/time');
    const row = office.getByTestId('time-entry').filter({ hasText: 'Lea Meier' }).first();
    await expect(row).toContainText(status, { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

test('a waiter clocks in after the PIN and out at the end; the manager sees the hours', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const tillContext = await browser.newContext();
  const officeContext = await browser.newContext();
  try {
    const till = await tillContext.newPage();
    const code = await terminalPairingCode('TZ', { name: 'Kasse Zeit E2E', type: 'pos' });
    await till.goto('/pos');
    await till.getByLabel('Kopplungscode').fill(code);
    await till.getByRole('button', { name: 'Koppeln' }).click();
    await expect(till.getByRole('heading', { name: 'PIN eingeben' })).toBeVisible({
      timeout: 30_000,
    });

    // The question does not block: the floor is usable while it shows.
    await unlockPos(till, '3000');
    const bar = till.getByTestId('clock-in-bar');
    await expect(bar).toBeVisible();
    await expect(till.getByTestId('table-1')).toBeEnabled();
    await bar.getByRole('button', { name: 'Einstempeln' }).click();
    await expect(bar).toBeHidden();
    await expect(till.getByTestId('clocked-in')).toContainText('Eingestempelt seit');

    // The manager sees Lea working.
    const office = await officeContext.newPage();
    const admin = DEMO_USERS.find((user) => user.email?.startsWith('admin@'))!;
    await office.goto('/login');
    await office.getByLabel('E-Mail').fill(admin.email!);
    await office.getByLabel('Passwort').fill(DEMO_BACKOFFICE_PASSWORD);
    await office.getByRole('button', { name: 'Anmelden' }).click();
    await expect(office).toHaveURL(/\/backoffice/);
    await expectLeaStatus(office, 'Arbeitet');

    // End of the shift: confirmed, clocked out and locked.
    await till.getByRole('button', { name: 'Ausstempeln' }).click();
    const confirm = till.getByRole('dialog', { name: 'Arbeitszeit beenden?' });
    await confirm.getByRole('button', { name: 'Ausstempeln und sperren' }).click();
    await expect(till.getByRole('heading', { name: 'PIN eingeben' })).toBeVisible();
    await expectLeaStatus(office, 'Abgeschlossen');

    // The next unlock asks again; "just a quick look" hides it until the next one.
    await unlockPos(till, '3000');
    await expect(bar).toBeVisible();
    await bar.getByRole('button', { name: 'Nur kurz nachsehen' }).click();
    await expect(bar).toBeHidden();
    await expect(till.getByRole('button', { name: 'Ausstempeln' })).toHaveCount(0);
  } finally {
    await tillContext.close();
    await officeContext.close();
  }
});
