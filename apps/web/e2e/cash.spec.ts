import { createDb, schema as s } from '@pos/db';
import { testDatabaseUrl } from '@pos/db/testing';
import { expect, type Page, test } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { openShift, pairPos, posLocalData, unlockPos } from './pos-helpers';

/**
 * Phase 4 gate, cash (RF-D12…RF-D15, RF-D19, RNF-02, DEC-038): a shift opens, takes cash, moves
 * cash and closes with the count WITHOUT internet; back online the cloud has the same shift and
 * expected cash, once. Then a manager closes a business day from the POS with their PIN.
 */
test.describe.configure({ mode: 'serial' });

async function shiftsOf(terminalPrefix: string) {
  const { db, pool } = createDb(testDatabaseUrl(), { connectionLimit: 1 });
  try {
    const [terminal] = await db
      .select({ id: s.terminals.id })
      .from(s.terminals)
      .where(eq(s.terminals.orderNumberPrefix, terminalPrefix));
    return await db.select().from(s.shifts).where(eq(s.shifts.terminalId, terminal!.id));
  } finally {
    await pool.end();
  }
}

async function nav(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'Kasse' }).getByRole('button', { name }).click();
}

test('a shift opens, takes cash and closes with the count offline; the cloud gets it once', async ({
  page,
  context,
}) => {
  test.setTimeout(240_000);
  await pairPos(page, 'K1');
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), {
      timeout: 30_000,
    })
    .toBe(true);

  await context.setOffline(true);
  await unlockPos(page, '3000');
  await expect(page.getByTestId('sync-level')).toHaveAttribute('data-level', 'standalone');

  // Without a shift, cash is not offered for payment.
  // A table order (bar and take-away lists are shared with the other specs of the location).
  await page.getByTestId('table-8').click();
  await page.getByRole('button', { name: 'Öffnen' }).click();
  await page.getByRole('button', { name: 'Vorspeisen', exact: true }).click();
  await page.getByTestId('product').filter({ hasText: 'Tomatensuppe' }).first().click();
  const number = (await page.getByTestId('order-number').innerText()).trim();
  await page.getByRole('button', { name: 'Senden', exact: true }).click();
  await page.getByRole('button', { name: 'Bezahlen' }).click();
  await expect(page.getByRole('button', { name: 'Bar', exact: true })).toBeDisabled();

  // Open the till's shift with CHF 200 counted (RF-D12).
  await openShift(page, 2);
  await expect(page.getByTestId('shift-expected')).toContainText('200.00');

  // A small expense from the drawer (RF-D13).
  await page.getByRole('button', { name: 'Bewegung' }).click();
  const movement = page.getByRole('dialog');
  await movement.getByRole('button', { name: 'Ausgabe' }).click();
  await movement.getByLabel('Betrag').fill('12.50');
  await movement.getByLabel('Grund').fill('Blumen');
  await movement.getByRole('button', { name: 'Erfassen' }).click();
  await expect(page.getByTestId('shift-expected')).toContainText('187.50');

  // The soup is paid in cash, exactly (CHF 9.50 → expected 197.00).
  await nav(page, 'Bestellungen');
  await page.getByTestId('order-row').filter({ hasText: number }).first().click();
  await page.getByRole('button', { name: 'Bezahlen' }).click();
  await page.getByRole('button', { name: 'Bar', exact: true }).click();
  await page.getByRole('button', { name: 'Passend' }).click();
  await page.getByRole('button', { name: 'Zahlung bestätigen' }).click();
  await expect(page.getByTestId('receipt-text')).toBeVisible();
  await nav(page, 'Kasse');
  const expected = (await page.getByTestId('shift-expected').innerText()).trim();

  // Close with the count: CHF 0.50 missing needs a comment (RF-D14).
  await page.getByTestId('close-shift-open').click();
  const close = page.getByRole('dialog');
  const target = Number(expected.replace(/[^\d.]/g, '')) * 100 - 50;
  await close.getByTestId('count-10000').fill(String(Math.floor(target / 10000)));
  await close.getByTestId('count-5').fill(String((target % 10000) / 5));
  await expect(close.getByTestId('close-difference')).toContainText('-0.50');
  await close.getByTestId('close-shift-confirm').click();
  await expect(close.getByRole('alert')).toBeVisible();
  await close.getByTestId('close-comment').fill('Münze fehlt');
  await close.getByTestId('close-shift-confirm').click();
  await expect(page.getByTestId('shift-report')).toBeVisible();
  await page.getByTestId('close-shift-done').click();
  await expect(page.getByTestId('open-shift')).toBeVisible();

  // A reload without network keeps it closed (RNF-02).
  await page.reload();
  await unlockPos(page, '3000');
  await nav(page, 'Kasse');
  await expect(page.getByTestId('open-shift')).toBeVisible();
  expect(await shiftsOf('K1')).toHaveLength(0);

  // Back online: the cloud has the shift, closed, with the expected cash the cashier signed.
  await context.setOffline(false);
  await expect(page.getByTestId('sync-pending')).toHaveAttribute('data-pending', '0', {
    timeout: 60_000,
  });
  const [shift] = await shiftsOf('K1');
  expect(shift).toMatchObject({
    status: 'closed',
    openingFloatRappen: 20000,
    differenceRappen: -50,
    differenceComment: 'Münze fehlt',
  });
  expect(shift!.expectedCashRappen).toBe(Number(expected.replace(/[^\d.]/g, '')) * 100);

  // Everything again: only duplicates.
  const local = await posLocalData(page);
  const response = await page.request.post('/api/v1/sync/push', {
    headers: { 'x-terminal-token': local.deviceToken },
    data: { operations: local.ops },
  });
  const { results } = (await response.json()) as { results: { status: string }[] };
  expect(results.every((r) => r.status === 'duplicate')).toBe(true);
  expect(await shiftsOf('K1')).toHaveLength(1);
});

test('a manager closes a business day from the POS with their PIN (Z)', async ({ page }) => {
  test.setTimeout(180_000);
  await pairPos(page, 'K1');
  await unlockPos(page, '3000');
  await nav(page, 'Kasse');
  await page.getByTestId('day-close-open').click();
  const dialog = page.getByRole('dialog');
  // Yesterday: no shift or order left open, so it closes.
  const yesterday = new Date(Date.now() - 36 * 3_600_000).toISOString().slice(0, 10);
  await dialog.getByLabel('Geschäftstag').fill(yesterday);
  await dialog.getByTestId('day-close-pin').fill('2000');
  await dialog.getByRole('button', { name: 'Weiter' }).click();
  await expect(dialog.getByTestId('z-summary')).toBeVisible({ timeout: 30_000 });
  await dialog.getByTestId('day-close-confirm').click();
  await expect(dialog.getByTestId('day-closed')).toContainText(`vom ${yesterday}`);
});

test('whoever holds the till unpairs it and it asks for a pairing code again', async ({ page }) => {
  test.setTimeout(120_000);
  await pairPos(page, 'K1');
  await unlockPos(page, '4001');
  await page.getByTestId('unpair-device').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Entkoppeln' }).click();
  await expect(page.getByLabel('Kopplungscode')).toBeVisible({ timeout: 30_000 });
});
