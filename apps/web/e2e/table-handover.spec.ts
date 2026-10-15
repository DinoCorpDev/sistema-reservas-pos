import { expect, test } from '@playwright/test';
import { pairPos, tapDigits, unlockPos } from './pos-helpers';

/** Handing a table to another waiter needs a manager's PIN (DEC-039). */
test('a waiter hands a table to a colleague with the manager PIN', async ({ page }) => {
  test.setTimeout(180_000);
  await pairPos(page, 'H2');
  await unlockPos(page, '4001');
  // A terrace table: the tables of the hall are used by the other specs of the suite.
  await page.getByRole('tab', { name: 'Terrasse' }).click();
  await page.getByTestId('table-T1').click();
  await page.getByRole('button', { name: 'Öffnen' }).click();
  await expect(page.getByTestId('order-number')).toBeVisible();

  await page.getByRole('button', { name: 'Mehr' }).click();
  await page.getByRole('button', { name: 'Bedienung wechseln' }).click();
  await page.getByRole('button', { name: 'Luca Rossi' }).click();
  const approval = page.getByRole('dialog').filter({ hasText: 'PIN' }).last();
  await expect(approval).toBeVisible();
  await tapDigits(page, '2000');
  await approval.getByRole('button', { name: 'Freigeben' }).click();
  await expect(approval).toBeHidden();
  await expect(page.getByText('Luca Rossi').first()).toBeVisible();
});
