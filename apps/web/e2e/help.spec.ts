import { expect, test } from '@playwright/test';
import { pairPos, unlockPos } from './pos-helpers';

/**
 * Manuals per role (RNF-21): the till opens its role's manual in a new tab, in German; it
 * switches to Spanish and to another role, and a wrong address is a 404.
 */
test('the till opens the manual of its role, in German and in Spanish', async ({ page }) => {
  test.setTimeout(120_000);
  await pairPos(page, 'K1');
  await unlockPos(page, '4001');

  // The manual is in the person's menu (the avatar), with the shift, theme and language.
  await page.getByTestId('person-menu').click();
  const [manual] = await Promise.all([
    page.waitForEvent('popup'),
    page.getByTestId('help-link').click(),
  ]);
  await expect(manual).toHaveURL(/\/help\/de\/(waiter|manager)$/);
  await expect(manual.getByTestId('manual')).toBeVisible();

  await manual.getByRole('link', { name: 'Küche' }).click();
  await expect(manual).toHaveURL(/\/help\/de\/kitchen$/);
  await expect(manual.getByRole('heading', { name: 'Küche: Bons am Küchenmonitor' })).toBeVisible();

  await manual.getByRole('link', { name: 'Español' }).click();
  await expect(manual).toHaveURL(/\/help\/es\/kitchen$/);
  await expect(
    manual.getByRole('heading', { name: 'Cocina: comandas en la pantalla' }),
  ).toBeVisible();

  const missing = await manual.goto('/help/fr/kitchen');
  expect(missing?.status()).toBe(404);
  await manual.close();
});
