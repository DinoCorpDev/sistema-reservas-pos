import { expect, test } from '@playwright/test';
import { issuePairingCode, pairPos } from './pos-helpers';

/** A device paired on one browser is not taken over by another one (DEC-041). */
test('a second browser is refused a paired device and goes back to the start menu', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const first = await browser.newContext();
  const second = await browser.newContext();
  try {
    await pairPos(await first.newPage(), 'H1');
    // A code left over from before: the device it pairs is still in use on the first browser.
    const code = await issuePairingCode('H1', { keepDevice: true });

    const page = await second.newPage();
    await page.goto('/pos');
    await page.getByLabel('Kopplungscode').fill(code);
    await page.getByRole('button', { name: 'Koppeln' }).click();
    const alert = page.getByTestId('sign-in-error');
    await expect(alert).toContainText('Keine freien Plätze');
    await expect(alert).toContainText('«Handheld 1» ist bereits auf einem anderen Gerät gekoppelt');

    await alert.getByRole('button', { name: 'Zur Startseite' }).last().click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('link', { name: /Küche/ })).toBeVisible();
  } finally {
    await first.close();
    await second.close();
  }
});
