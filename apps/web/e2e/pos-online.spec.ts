import { createDb, schema as s } from '@pos/db';
import { testDatabaseUrl } from '@pos/db/testing';
import { expect, type Page, test } from '@playwright/test';
import { and, eq, inArray } from 'drizzle-orm';
import { cloudState, pairPos, tapDigits, unlockPos } from './pos-helpers';

/**
 * POS with a connection: manager approvals on the same device (RN-15, RF-A05), prepay and
 * hand-over at the bar (RF-C17), a receipt copy (RF-D24) and a refund linked to the payment
 * (RF-D07, RN-14). Everything ends up in the cloud with its approver in the audit.
 */

async function category(page: Page, name: string) {
  await page.getByRole('button', { name, exact: true }).click();
}

async function product(page: Page, name: string) {
  await page.getByTestId('product').filter({ hasText: name }).first().click();
}

/** A manager (Marco, PIN 2000) approves on the same terminal. */
async function managerApproves(page: Page) {
  const approval = page.getByRole('dialog', { name: 'Freigabe durch Führungsperson' });
  await expect(approval).toBeVisible();
  await tapDigits(page, '2000');
  await approval.getByRole('button', { name: 'Freigeben' }).click();
  await expect(approval).toBeHidden();
}

test('approvals, prepay at the bar, a receipt copy and a refund', async ({ page }) => {
  test.setTimeout(240_000);
  await pairPos(page, 'K1');
  await unlockPos(page, '4001');
  await expect(page.getByTestId('sync-level')).toHaveAttribute('data-level', 'cloud');

  // A bar order: numbered by the cloud, the location's authority (no prefix).
  // The counter lists what is open; a new order is opened only on purpose (DEC-034).
  await page.getByRole('button', { name: 'Theke' }).click();
  await page.getByRole('button', { name: 'Neue Bestellung' }).click();
  await expect(page.getByTestId('order-number')).toContainText(/\d{4}/);
  await expect(page.getByTestId('order-number')).not.toContainText('K1-');
  await category(page, 'Vorspeisen');
  await product(page, 'Tomatensuppe');
  await category(page, 'Hauptgerichte');
  await product(page, 'Wiener Schnitzel mit Pommes frites');
  await page.getByRole('button', { name: 'Senden', exact: true }).click();

  // Voiding a dish already in the kitchen: the waiter needs a manager (RN-15).
  const soup = page.getByTestId('line').filter({ hasText: 'Tomatensuppe' });
  await soup.getByRole('button', { name: 'Position bearbeiten' }).click();
  const lineDialog = page.getByRole('dialog').first();
  await lineDialog.getByRole('button', { name: 'Stornieren' }).click();
  await lineDialog.getByRole('radio', { name: 'Gast verzichtet' }).click();
  await lineDialog.getByRole('button', { name: 'Stornieren' }).click();
  await managerApproves(page);
  await expect(soup).toHaveAttribute('data-status', 'voided');

  // 50 % staff discount on the order: above 20 % it needs a manager too.
  await page.getByRole('button', { name: 'Mehr' }).click();
  await page.getByRole('button', { name: 'Rabatt auf Bestellung' }).click();
  await page.getByRole('button', { name: /^Personal/ }).click();
  await managerApproves(page);
  // Schnitzel 36.00 − 50 % = 18.00
  await expect(page.getByTestId('order-total')).toContainText('18.00');

  // Prepay before handing over (RF-C17).
  await page.getByRole('button', { name: 'Bezahlen' }).click();
  await page.getByRole('button', { name: 'Bar', exact: true }).click();
  await page.getByLabel('Gegeben').fill('20');
  await expect(page.getByTestId('payment-change')).toContainText('2.00');
  await page.getByRole('button', { name: 'Zahlung bestätigen' }).click();
  await expect(page.getByTestId('receipt-text')).toContainText('Rabatt');
  await page.getByRole('button', { name: 'Zur Bestellung' }).click();
  // Back at the counter, the paid order waits in the list until it is handed over (DEC-034).
  const number = /\d{4}/.exec((await page.getByTestId('order-number').textContent()) ?? '')![0];
  await page
    .getByRole('navigation', { name: 'Kasse' })
    .getByRole('button', { name: 'Theke' })
    .click();
  const card = page.getByTestId('counter-order').filter({ hasText: number });
  await expect(card).toHaveAttribute('data-state', 'in_kitchen');
  await card.click();
  await page.getByRole('button', { name: 'Ausgegeben' }).click();
  await expect(page.locator('[data-testid="line"][data-status="served"]')).toHaveCount(1);

  // From the list of closed orders: a copy, then a refund (approved).
  await page
    .getByRole('navigation', { name: 'Kasse' })
    .getByRole('button', { name: 'Bestellungen' })
    .click();
  await page.getByRole('tab', { name: 'Heute abgeschlossen' }).click();
  await page.getByTestId('closed-order-row').first().click();
  await page.getByRole('button', { name: 'Kopie drucken' }).click();
  await expect(page.getByTestId('receipt-text')).toContainText('KOPIE');
  await page.getByRole('button', { name: 'Fertig' }).click();

  await page
    .getByRole('navigation', { name: 'Kasse' })
    .getByRole('button', { name: 'Bestellungen' })
    .click();
  await page.getByRole('tab', { name: 'Heute abgeschlossen' }).click();
  await page.getByTestId('closed-order-row').first().click();
  await page.getByRole('button', { name: 'Rückerstatten' }).click();
  const refund = page.getByRole('dialog', { name: 'Zahlung rückerstatten' });
  await refund.getByLabel('Betrag').fill('5');
  await refund.getByLabel('Grund').fill('Reklamation');
  await refund.getByRole('button', { name: 'Rückerstatten' }).click();
  await managerApproves(page);

  // Everything reaches the cloud, with the approver in the audit trail.
  await expect(page.getByTestId('sync-pending')).toHaveAttribute('data-pending', '0', {
    timeout: 60_000,
  });
  const state = await cloudState('K1');
  // Other tests may leave orders on this terminal: ours is the paid bar order of CHF 18.00.
  const order = state.orders.find((o) => o.channel === 'bar' && o.totalRappen === 1800)!;
  expect(order).toMatchObject({ status: 'closed', totalRappen: 1800 });
  expect(order.displayNumber).toMatch(/^\d{4}$/);
  const receipts = state.receipts.filter((r) => r.orderId === order.id);
  expect(receipts.map((r) => r.copyNumber).sort()).toEqual([0, 1]);

  const { db, pool } = createDb(testDatabaseUrl(), { connectionLimit: 1 });
  try {
    const refunds = await db.select().from(s.refunds).where(eq(s.refunds.orderId, order.id));
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ amountRappen: 500 });
    const audits = await db
      .select({ action: s.auditEvents.action, approver: s.auditEvents.authorizedByUserId })
      .from(s.auditEvents)
      .where(
        and(
          inArray(s.auditEvents.action, [
            'order.item_voided',
            'order.discount_applied',
            'payment.refunded',
          ]),
          eq(
            s.auditEvents.terminalId,
            state.payments.find((p) => p.orderId === order.id)!.terminalId!,
          ),
        ),
      );
    expect(audits.map((a) => a.action).sort()).toEqual([
      'order.discount_applied',
      'order.item_voided',
      'payment.refunded',
    ]);
    expect(new Set(audits.map((a) => a.approver)).size).toBe(1);
    expect(audits[0]!.approver).not.toBeNull();
  } finally {
    await pool.end();
  }
});
