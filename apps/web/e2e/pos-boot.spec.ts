import { expect, test } from '@playwright/test';
import { closeSignInError, pairPos, tapDigits, unlockPos } from './pos-helpers';

/**
 * The POS boots, pairs with a code from the backoffice (RF-A06) and the PIN alone identifies
 * the person (DEC-023); a wrong PIN is refused. Both work again without network.
 */
test('pairs, unlocks with a PIN and keeps working offline', async ({ page, context }) => {
  await pairPos(page);
  await expect(page.getByTestId('sync-level')).toHaveAttribute('data-level', 'cloud');

  await tapDigits(page, '9876');
  await page.getByRole('button', { name: 'Entsperren' }).click();
  await expect(page.getByText(/Falsche PIN\. Noch 4 Versuche/)).toBeVisible();
  await closeSignInError(page);

  await unlockPos(page, '4001');
  await expect(page.getByTestId('pos-user')).toHaveText('Anna Huber');

  // The service worker serves the POS; reload without network and unlock again.
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), {
      timeout: 30_000,
    })
    .toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'PIN eingeben' })).toBeVisible();
  await unlockPos(page, '2000');
  await expect(page.getByTestId('pos-user')).toHaveText('Marco Brunner');
  await expect(page.getByTestId('sync-level')).toHaveAttribute('data-level', 'standalone');
  await context.setOffline(false);
});
