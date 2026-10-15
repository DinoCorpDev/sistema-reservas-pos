import { expect, test } from '@playwright/test';
import { pairPos, unlockPos } from './pos-helpers';

/**
 * Two tabs of the POS on the same device share its local database and pull cursor: what one of
 * them records must show in the other at once, without waiting for the network.
 */
test('a table opened in one tab is occupied in the other tab of the same device', async ({
  context,
  page,
}) => {
  test.setTimeout(180_000);
  await pairPos(page, 'H2');
  await unlockPos(page, '4001');
  const other = await context.newPage();
  await other.goto('/pos');
  await unlockPos(other, '3000');
  await expect(other.getByTestId('table-4')).toHaveAttribute('data-state', 'free');

  await page.getByTestId('table-4').click();
  await page.getByRole('button', { name: 'Öffnen' }).click();
  await expect(page.getByTestId('order-number')).toBeVisible();

  // The other tab sees it without a reload, well before any sync cycle.
  await expect(other.getByTestId('table-4')).not.toHaveAttribute('data-state', 'free', {
    timeout: 3_000,
  });
});
