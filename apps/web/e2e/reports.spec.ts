import { DEMO_BACKOFFICE_PASSWORD, DEMO_USERS } from '@pos/db/testing';
import { expect, test } from '@playwright/test';
import { terminalPairingCode } from './hub-helpers';
import { unlockPos } from './pos-helpers';

/**
 * The gate of Phase 4 (RF-F01, RF-F02, RF-F04, RF-F10): after a sale at the till, today's
 * sales report, its MWST and the accounting export add up to the Z the cash page shows, to the
 * rappen; the owner sees the day on the overview.
 */

/** Σ of a CSV column in CHF, as rappen ("12.50" → 1250). */
function sumColumn(csv: string, column: number, rowFilter: (cells: string[]) => boolean) {
  return csv
    .split('\r\n')
    .slice(1)
    .filter((line) => line.length > 0)
    .map((line) => line.split(';'))
    .filter(rowFilter)
    .reduce((total, cells) => total + Math.round(Number(cells[column]) * 100), 0);
}

test('today’s reports and the accounting file add up to the Z', async ({ browser }) => {
  test.setTimeout(240_000);
  const tillContext = await browser.newContext();
  const officeContext = await browser.newContext();
  try {
    // A schnitzel sold and paid by card at a till of its own.
    const till = await tillContext.newPage();
    const code = await terminalPairingCode('RB', { name: 'Kasse Berichte E2E', type: 'pos' });
    await till.goto('/pos');
    await till.getByLabel('Kopplungscode').fill(code);
    await till.getByRole('button', { name: 'Koppeln' }).click();
    await expect(till.getByRole('heading', { name: 'PIN eingeben' })).toBeVisible({
      timeout: 30_000,
    });
    await unlockPos(till, '3000');
    await till.getByTestId('table-3').click();
    await till.getByRole('button', { name: 'Öffnen' }).click();
    await till.getByRole('button', { name: 'Hauptgerichte', exact: true }).click();
    await till
      .getByTestId('product')
      .filter({ hasText: 'Wiener Schnitzel mit Pommes frites' })
      .first()
      .click();
    await till.getByRole('button', { name: 'Senden', exact: true }).click();
    await till.getByRole('button', { name: 'Bezahlen' }).click();
    await till.getByRole('button', { name: 'Karte', exact: true }).click();
    await till.getByRole('button', { name: 'Zahlung bestätigen' }).click();
    await expect(till.getByTestId('receipt-text')).toBeVisible();
    await expect(till.getByTestId('sync-pending')).toHaveAttribute('data-pending', '0', {
      timeout: 30_000,
    });

    // The backoffice: the Z of today as the cash page computes it.
    const office = await officeContext.newPage();
    const admin = DEMO_USERS.find((user) => user.email?.startsWith('admin@'))!;
    await office.goto('/login');
    await office.getByLabel('E-Mail').fill(admin.email!);
    await office.getByLabel('Passwort').fill(DEMO_BACKOFFICE_PASSWORD);
    await office.getByRole('button', { name: 'Anmelden' }).click();
    await expect(office).toHaveURL(/\/backoffice/);

    // The owner's overview shows today's sales.
    await expect(office.getByTestId('dashboard-sales')).toBeVisible();

    await office.goto('/backoffice/cash');
    const z = office.getByTestId('closing-totals');
    const zSales = Number(await z.getAttribute('data-sales-rappen'));
    const zTax = Number(await z.getAttribute('data-tax-rappen'));
    expect(zSales).toBeGreaterThanOrEqual(3600);
    expect(zTax).toBeGreaterThan(0);

    // Today's sales report and its MWST: the Z to the rappen.
    await office.goto('/backoffice/reports');
    await office.getByRole('link', { name: 'Heute' }).click();
    await expect(office.getByTestId('report-sales-total')).toHaveAttribute(
      'data-rappen',
      String(zSales),
    );
    const query = new URL(office.url()).searchParams;
    expect(query.get('from')).toBe(query.get('to'));
    await office.goto(`/backoffice/reports/vat?${query.toString()}`);
    await expect(office.getByTestId('vat-tax')).toHaveAttribute('data-rappen', String(zTax));

    // The accounting file of the day: its sales rows add up to the Z.
    const csv = await office.evaluate(async (search) => {
      const response = await fetch(`/backoffice/reports/export/accounting?${search}`);
      return response.text();
    }, query.toString());
    expect(csv.split('\r\n')[0]).toContain('Geschäftstag;Art;Zahlungsart');
    expect(sumColumn(csv, 5, (cells) => cells[1] === 'Umsatz')).toBe(zSales);
    expect(sumColumn(csv, 6, (cells) => cells[1] === 'Umsatz')).toBe(zTax);
  } finally {
    await tillContext.close();
    await officeContext.close();
  }
});
