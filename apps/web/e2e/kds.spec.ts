import { expect, type Page, test } from '@playwright/test';
import { type FakePrinter, startFakePrinter } from '../../hub/src/printing/fake-printer';
import {
  HUB_URL,
  pointPrinter,
  type RunningHub,
  setHubUrls,
  startHub,
  terminalPairingCode,
} from './hub-helpers';
import { closeSignInError, issuePairingCode, tapDigits, unlockPos } from './pos-helpers';

/**
 * The kitchen with the LAN hub (Phase 3, RF-C20…RF-C28, RNF-06, RNF-07): a waiter sends from the
 * POS and the kitchen display shows the ticket in under 2 seconds, the station printer prints it
 * in the kitchen language with allergens, a void after sending is struck on the screen and
 * printed as a storno slip (RN-13), "ready" in the kitchen tells the waiter (RF-C23), and the
 * recall brings a finished ticket back (RF-C28). Real hub process, printer simulated on TCP.
 */
test.describe.configure({ mode: 'serial' });

let hub: RunningHub | null = null;
let printer: FakePrinter;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  printer = await startFakePrinter();
  await pointPrinter('kitchen', printer.port);
  await setHubUrls([HUB_URL]);
  hub = await startHub();
});

test.afterAll(async () => {
  await hub?.stop();
  await setHubUrls([]);
  await printer?.close();
});

/** A POS of its own ("KE"), so the other specs' terminals and audits stay untouched. */
async function pairOwnPos(page: Page) {
  const code = await terminalPairingCode('KE', { name: 'Kasse Küche E2E', type: 'pos' });
  await page.goto('/pos');
  await page.getByLabel('Kopplungscode').fill(code);
  await page.getByRole('button', { name: 'Koppeln' }).click();
  await expect(page.getByRole('heading', { name: 'PIN eingeben' })).toBeVisible({
    timeout: 30_000,
  });
}

async function pairKds(page: Page, prefix: string, pin: string) {
  const code = await issuePairingCode(prefix);
  await page.goto('/kds');
  await page.getByLabel('Kopplungscode').fill(code);
  await page.getByRole('button', { name: 'Koppeln' }).click();
  await expect(page.getByRole('heading', { name: 'PIN eingeben' })).toBeVisible({
    timeout: 30_000,
  });
  // A waiter's PIN does not open the kitchen display: its marks need kitchen staff (DEC-030).
  await tapDigits(page, '4001');
  await page.getByRole('button', { name: 'Entsperren' }).click();
  await expect(page.getByText('Anna Huber hat keine Küchenberechtigung')).toBeVisible();
  await closeSignInError(page);
  await tapDigits(page, pin);
  await page.getByRole('button', { name: 'Entsperren' }).click();
}

const printedText = () => printer.jobs.map((job) => job.lines.join('\n'));

test('POS → hub → KDS in under 2 s, printed, struck, ready and recalled', async ({ browser }) => {
  test.setTimeout(240_000);
  const posContext = await browser.newContext();
  const kdsContext = await browser.newContext();
  const pastryContext = await browser.newContext();
  const pos = await posContext.newPage();
  const kds = await kdsContext.newPage();
  const pastry = await pastryContext.newPage();
  try {
    // The waiter's POS and the kitchen display both work through the hub (RF-C27).
    await pairOwnPos(pos);
    await unlockPos(pos, '4001');
    await expect(pos.getByTestId('sync-level')).toHaveAttribute('data-level', 'hub', {
      timeout: 30_000,
    });
    await pairKds(kds, 'D1', '5000');
    await expect(kds.getByTestId('kds-station')).toHaveText('Küche');
    await expect(kds.getByTestId('sync-level')).toHaveAttribute('data-level', 'hub', {
      timeout: 30_000,
    });

    // Table 7: a soup and a schnitzel, sent to the kitchen.
    await pos.getByTestId('table-7').click();
    await pos.getByRole('button', { name: 'Öffnen' }).click();
    await pos.getByRole('button', { name: 'Vorspeisen', exact: true }).click();
    await pos.getByTestId('product').filter({ hasText: 'Tomatensuppe' }).first().click();
    await pos.getByRole('button', { name: 'Hauptgerichte', exact: true }).click();
    await pos
      .getByTestId('product')
      .filter({ hasText: 'Wiener Schnitzel mit Pommes frites' })
      .first()
      .click();
    await expect(pos.getByTestId('line')).toHaveCount(2);
    const ticket = kds.getByTestId('kds-ticket').filter({ hasText: 'Tisch 7' });
    await expect(ticket).toHaveCount(0);

    const sentAt = Date.now();
    await pos.getByRole('button', { name: 'Senden', exact: true }).click();
    await expect(ticket).toBeVisible({ timeout: 5_000 });
    // RNF-06 / RNF-07: sent on the POS, on the kitchen display in under 2 s on the LAN.
    expect(Date.now() - sentAt).toBeLessThan(2_000);
    await expect(ticket.getByTestId('kds-item')).toHaveCount(2);
    await expect(ticket.getByTestId('kds-allergens').first()).toBeVisible();

    // The station printer got the ticket, in German, with the allergens (RF-C26, RF-C25).
    await expect.poll(() => printedText().join('\n---\n'), { timeout: 15_000 }).toContain('KÜCHE');
    const [printed] = printedText();
    expect(printed).toContain('Tisch 7');
    expect(printed).toContain('Wiener Schnitzel mit Pommes frites');
    expect(printed).toContain('Allergene:');

    // A void after sending: struck on the screen, a notice, a storno slip (RN-13, RF-C10).
    const soup = pos.getByTestId('line').filter({ hasText: 'Tomatensuppe' });
    await soup.getByRole('button', { name: 'Position bearbeiten' }).click();
    const lineDialog = pos.getByRole('dialog').first();
    await lineDialog.getByRole('button', { name: 'Stornieren' }).click();
    await lineDialog.getByRole('radio', { name: 'Gast verzichtet' }).click();
    await lineDialog.getByRole('button', { name: 'Stornieren' }).click();
    const approval = pos.getByRole('dialog', { name: 'Freigabe durch Führungsperson' });
    await tapDigits(pos, '2000');
    await approval.getByRole('button', { name: 'Freigeben' }).click();
    await expect(approval).toBeHidden();
    await expect(kds.getByTestId('kds-storno')).toContainText('Tomatensuppe');
    await expect(ticket.locator('[data-testid="kds-item"][data-status="voided"]')).toHaveCount(1);
    await expect
      .poll(() => printedText().some((text) => text.includes('*** STORNO')), { timeout: 15_000 })
      .toBe(true);
    await kds.getByRole('button', { name: 'Gesehen' }).click();
    await expect(kds.getByTestId('kds-storno')).toBeHidden();

    // The kitchen bumps the ticket: it leaves the board and the waiter hears it (RF-C22, RF-C23).
    await ticket.getByRole('button', { name: 'Fertig' }).click();
    await expect(ticket).toHaveCount(0);
    const readyNotice = pos.getByText('Tisch 7: 1 Position bereit');
    await expect(readyNotice).toBeVisible({ timeout: 10_000 });
    // A tap anywhere on the notice closes it; there is no close button to aim at.
    await expect(pos.locator('[data-sonner-toast] [data-close-button]')).toHaveCount(0);
    await readyNotice.click();
    await expect(readyNotice).toBeHidden();
    // The header keeps counting it after the notice is gone (DEC-034).
    const readyBadge = pos.getByTestId('ready-badge-tables');
    await expect(readyBadge).toContainText('1 Tisch hat etwas bereit zum Servieren');
    await pos
      .getByRole('navigation', { name: 'Kasse' })
      .getByRole('button', { name: 'Tische' })
      .click();
    await expect(pos.getByTestId('table-7')).toHaveAttribute('data-state', 'ready');

    // Recall (RF-C28): from the finished list back to the board.
    await kds.getByRole('tab', { name: 'Erledigt' }).click();
    const done = kds.getByTestId('kds-ticket').filter({ hasText: 'Tisch 7' });
    await expect(done).toHaveAttribute('data-status', 'ready');
    await done.getByRole('button', { name: 'Zurückholen' }).click();
    await kds.getByRole('tab', { name: /^Offen/ }).click();
    await expect(kds.getByTestId('kds-ticket').filter({ hasText: 'Tisch 7' })).toHaveAttribute(
      'data-status',
      'preparing',
    );
    // Back in the kitchen: nothing left to hand over at table 7.
    await expect(readyBadge).toHaveCount(0, { timeout: 10_000 });

    // After the first service the table orders a dessert: it goes to the pastry station's own
    // display. Leaving the order without sending it is not possible by mistake (RF-C09, RF-C21).
    await pairKds(pastry, 'D3', '5000');
    await expect(pastry.getByTestId('kds-station')).toHaveText('Patisserie');
    await pos.getByTestId('table-7').click();
    await pos.getByRole('button', { name: 'Desserts', exact: true }).click();
    await pos.getByTestId('product').filter({ hasText: 'Zuger Kirschtorte' }).first().click();
    await expect(pos.getByTestId('line').filter({ hasText: 'Zuger Kirschtorte' })).toBeVisible();
    // Someone is logged in at the pastry display: once the POS knows, the dessert stays there
    // (DEC-033). Until then it shows that nobody is there.
    await expect(pos.getByTestId('routing-notice')).toBeHidden({ timeout: 15_000 });
    await pos
      .getByRole('navigation', { name: 'Kasse' })
      .getByRole('button', { name: 'Tische' })
      .click();
    const unsent = pos.getByRole('dialog', { name: 'Noch nicht an die Küche gesendet' });
    await expect(unsent).toContainText('1 Position ist noch nicht gesendet');
    await unsent.getByRole('button', { name: 'Jetzt senden' }).click();
    await expect(unsent).toBeHidden();
    await expect(pos.getByTestId('table-7')).toBeVisible();
    await expect(
      pastry.getByTestId('kds-ticket').filter({ hasText: 'Zuger Kirschtorte' }),
    ).toBeVisible({ timeout: 5_000 });
    // The kitchen station does not get it.
    await expect(kds.getByTestId('kds-item').filter({ hasText: 'Zuger Kirschtorte' })).toHaveCount(
      0,
    );

    // Nobody is logged in at the bar display: the POS warns before the beer goes to the kitchen
    // instead, and the kitchen sees whose it is (DEC-033).
    await pos.getByTestId('table-7').click();
    await pos.getByRole('button', { name: 'Bier & Wein', exact: true }).click();
    await pos.getByTestId('product').filter({ hasText: 'Amber Bier 3.3 dl' }).first().click();
    await expect(pos.getByTestId('routing-notice')).toContainText(
      'Niemand angemeldet: Bar. Die Positionen gehen an Küche.',
      { timeout: 15_000 },
    );
    const confirm = pos.getByTestId('send-confirm');
    await pos.getByRole('button', { name: 'Senden', exact: true }).click();
    await expect(confirm).toContainText('Niemand angemeldet: Bar');
    await expect(confirm).toContainText('1 Position von Bar → Küche');
    // Cancelled: nothing leaves.
    await confirm.getByRole('button', { name: 'Abbrechen' }).click();
    await expect(confirm).toBeHidden();
    const beer = pos.getByTestId('line').filter({ hasText: 'Amber Bier' });
    await expect(beer).toHaveAttribute('data-status', 'pending');
    // Confirmed: it reaches the kitchen display marked as the bar's, and the kitchen printer.
    await pos.getByRole('button', { name: 'Senden', exact: true }).click();
    await confirm.getByRole('button', { name: 'Ja, an Küche senden' }).click();
    await expect(beer).toHaveAttribute('data-status', 'sent');
    await expect(pos.getByText('1 Position von Bar ging an Küche.')).toBeVisible();
    const beerOnKitchen = kds.getByTestId('kds-item').filter({ hasText: 'Amber Bier' });
    await expect(beerOnKitchen).toBeVisible({ timeout: 5_000 });
    await expect(beerOnKitchen.getByTestId('kds-from-station')).toHaveText('für Bar');
    await expect
      .poll(() => printedText().some((text) => text.includes('(für Bar)')), { timeout: 15_000 })
      .toBe(true);
  } finally {
    await posContext.close();
    await kdsContext.close();
    await pastryContext.close();
  }
});

test('an allergy at the table reaches the kitchen screen and the printed ticket (DEC-037)', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const posContext = await browser.newContext();
  const kdsContext = await browser.newContext();
  const pos = await posContext.newPage();
  const kds = await kdsContext.newPage();
  try {
    await pairOwnPos(pos);
    await unlockPos(pos, '4001');
    await pairKds(kds, 'D1', '5000');
    await expect(kds.getByTestId('kds-station')).toHaveText('Küche');

    // Table 2: the waiter notes gluten and "Kiwi" before ordering.
    await pos.getByTestId('table-2').click();
    await pos.getByRole('button', { name: 'Öffnen' }).click();
    await pos.getByTestId('allergy-button').click();
    const dialog = pos.getByRole('dialog', { name: 'Allergien am Tisch' });
    await dialog.getByRole('button', { name: 'Gluten', exact: true }).click();
    await dialog.getByLabel('Andere Allergie').fill('Kiwi');
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(dialog).toBeHidden();
    await expect(pos.getByTestId('order-allergy')).toHaveText('Allergie: Gluten · Kiwi');

    // A schnitzel contains gluten: the waiter is warned, the line is added anyway.
    await pos.getByRole('button', { name: 'Hauptgerichte', exact: true }).click();
    await pos
      .getByTestId('product')
      .filter({ hasText: 'Wiener Schnitzel mit Pommes frites' })
      .first()
      .click();
    await expect(pos.getByText('Wiener Schnitzel mit Pommes frites enthält Gluten')).toBeVisible();
    await expect(pos.getByTestId('line')).toHaveCount(1);
    await pos.getByRole('button', { name: 'Senden', exact: true }).click();

    // The kitchen screen shows it in red on the ticket, the printer on paper.
    const ticket = kds.getByTestId('kds-ticket').filter({ hasText: 'Tisch 2' });
    await expect(ticket.getByTestId('kds-allergy')).toContainText('ALLERGIE AM TISCH', {
      timeout: 10_000,
    });
    await expect(ticket.getByTestId('kds-allergy')).toContainText('Gluten · Kiwi');
    await expect
      .poll(
        () =>
          printedText().some(
            (text) => text.includes('Tisch 2') && text.includes('!!! ALLERGIE AM TISCH !!!'),
          ),
        { timeout: 15_000 },
      )
      .toBe(true);

    // On the floor, the table carries the warning too.
    await pos
      .getByRole('navigation', { name: 'Kasse' })
      .getByRole('button', { name: 'Tische' })
      .click();
    await expect(pos.getByTestId('table-2').getByTestId('table-allergy')).toBeVisible();
  } finally {
    await posContext.close();
    await kdsContext.close();
  }
});
