import { createDb, normalizePairingCode, pairingCode, schema as s, sha256Hex } from '@pos/db';
import { testDatabaseUrl } from '@pos/db/testing';
import { expect, type Page } from '@playwright/test';
import { and, eq, inArray } from 'drizzle-orm';

/**
 * Helpers of the POS E2E tests. They act on the E2E database the way the backoffice would
 * (issuing a pairing code), and drive the POS like a waiter: the keypad, never the keyboard.
 */

/**
 * A fresh pairing code for a seeded terminal of the demo location (e.g. "Kasse 1", K1). Like the
 * backoffice, it unpairs the terminal first: a paired one refuses a new device (DEC-041).
 */
export async function issuePairingCode(
  prefix = 'K1',
  { keepDevice = false }: { keepDevice?: boolean } = {},
): Promise<string> {
  const { db, pool } = createDb(testDatabaseUrl(), { connectionLimit: 1 });
  try {
    const [terminal] = await db
      .select({ id: s.terminals.id })
      .from(s.terminals)
      .where(and(eq(s.terminals.orderNumberPrefix, prefix), eq(s.terminals.isActive, true)));
    if (!terminal) throw new Error(`No terminal with prefix ${prefix} in the E2E database`);
    const code = pairingCode();
    await db
      .update(s.terminals)
      .set({
        ...(keepDevice ? {} : { deviceTokenHash: null }),
        pairingCodeHash: sha256Hex(normalizePairingCode(code)),
        pairingExpiresAt: new Date(Date.now() + 15 * 60_000),
      })
      .where(eq(s.terminals.id, terminal.id));
    return code;
  } finally {
    await pool.end();
  }
}

/** Types digits on the on-screen keypad. */
export async function tapDigits(page: Page, digits: string): Promise<void> {
  const keypad = page.getByRole('group', { name: 'Zifferntastatur' }).last();
  for (const digit of digits)
    await keypad.getByRole('button', { name: digit, exact: true }).click();
}

/** Pairs the POS on this page with a seeded terminal and waits until it asks for a PIN. */
export async function pairPos(page: Page, prefix = 'K1'): Promise<void> {
  const code = await issuePairingCode(prefix);
  await page.goto('/pos');
  await page.getByLabel('Kopplungscode').fill(code);
  await page.getByRole('button', { name: 'Koppeln' }).click();
  await expect(page.getByRole('heading', { name: 'PIN eingeben' })).toBeVisible({
    timeout: 30_000,
  });
}

/** What the cloud stored for one terminal (the E2E database), to prove nothing was duplicated. */
export async function cloudState(prefix = 'K1') {
  const { db, pool } = createDb(testDatabaseUrl(), { connectionLimit: 1 });
  try {
    const [terminal] = await db
      .select({ id: s.terminals.id })
      .from(s.terminals)
      .where(eq(s.terminals.orderNumberPrefix, prefix));
    const terminalId = terminal!.id;
    const operations = await db
      .select({ id: s.syncOperations.id, type: s.syncOperations.operation })
      .from(s.syncOperations)
      .where(eq(s.syncOperations.terminalId, terminalId));
    const orders = await db.select().from(s.orders).where(eq(s.orders.terminalId, terminalId));
    const orderIds = orders.map((o) => o.id);
    const payments = orderIds.length
      ? await db.select().from(s.payments).where(inArray(s.payments.orderId, orderIds))
      : [];
    const receipts = orderIds.length
      ? await db.select().from(s.receipts).where(inArray(s.receipts.orderId, orderIds))
      : [];
    return { operations, orders, payments, receipts };
  } finally {
    await pool.end();
  }
}

/** The device token and every operation stored in the POS (IndexedDB), read from the page. */
export function posLocalData(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{ deviceToken: string; ops: unknown[] }>((resolve, reject) => {
        const request = indexedDB.open('sistema-reservas-pos');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(['meta', 'ops'], 'readonly');
          const device = tx.objectStore('meta').get('device');
          const ops = tx.objectStore('ops').getAll();
          tx.oncomplete = () =>
            resolve({
              deviceToken: (device.result as { value: { deviceToken: string } }).value.deviceToken,
              ops: (ops.result as { op: unknown }[]).map((row) => row.op),
            });
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
}

export async function unlockPos(page: Page, pin: string): Promise<void> {
  await tapDigits(page, pin);
  await page.getByRole('button', { name: 'Entsperren' }).click();
  await expect(page.getByTestId('pos-user')).toBeVisible({ timeout: 15_000 });
}

/**
 * Opens the shift of this till with CHF 100 notes counted as float (RF-D12): cash needs an open
 * shift (RN-19, DEC-038). Leaves the POS on the cash screen.
 */
export async function openShift(page: Page, hundreds = 2): Promise<void> {
  await page.getByTestId('nav-cash').click();
  await page.getByTestId('count-10000').fill(String(hundreds));
  await page.getByTestId('open-shift-confirm').click();
  await expect(page.getByTestId('shift-open')).toBeVisible({ timeout: 15_000 });
}

/** Closes the sign-in error modal (PIN or pairing) and returns to the keypad. */
export async function closeSignInError(page: Page): Promise<void> {
  await page.getByTestId('sign-in-error').getByRole('button', { name: 'OK' }).last().click();
  await expect(page.getByTestId('sign-in-error')).toBeHidden();
}

/**
 * Turns "one device per person" (DEC-040) on or off for the demo location. The suites sign the
 * same people in on many devices and close pages without locking them, so it is off by default
 * in the E2E database; the sessions spec turns it on.
 */
export async function setOneDevicePerPerson(enabled: boolean): Promise<void> {
  const { db, pool } = createDb(testDatabaseUrl(), { connectionLimit: 1 });
  try {
    const locations = await db.select().from(s.locations);
    for (const location of locations) {
      const settings = (location.settings ?? {}) as { security?: Record<string, unknown> };
      await db
        .update(s.locations)
        .set({
          settings: {
            ...settings,
            security: { ...settings.security, oneDevicePerPerson: enabled },
          } as typeof location.settings,
          updatedAt: new Date(),
        })
        .where(eq(s.locations.id, location.id));
    }
  } finally {
    await pool.end();
  }
}
