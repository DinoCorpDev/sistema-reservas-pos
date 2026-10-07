import { formatHlc, newId } from '@pos/core';
import { createDb, schema as s } from '@pos/db';
import { DEMO_BACKOFFICE_PASSWORD, DEMO_USERS, testDatabaseUrl } from '@pos/db/testing';
import { expect, test } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { issuePairingCode } from './pos-helpers';

/**
 * RNF-04: an operation that broke a rule offline is applied and listed to the manager, who
 * reviews it and marks it resolved with a note (audited).
 */
test('a manager sees a synchronization conflict and resolves it', async ({ page, request }) => {
  // A device pushes an update for an order the cloud never received.
  const code = await issuePairingCode('D1');
  const paired = await request.post('/api/v1/terminals/pair', { data: { code } });
  const device = (await paired.json()) as {
    deviceToken: string;
    terminal: { id: string };
    organizationId: string;
    location: { id: string };
  };
  const { db, pool } = createDb(testDatabaseUrl(), { connectionLimit: 1 });
  const [waiter] = await db
    .select({ id: s.users.id })
    .from(s.users)
    .where(eq(s.users.displayName, 'Anna Huber'));
  await pool.end();
  const now = Date.now();
  const operation = {
    id: newId(),
    schemaVersion: 1,
    hlc: formatHlc({ physical: now, counter: 0 }),
    deviceAt: new Date(now).toISOString(),
    organizationId: device.organizationId,
    locationId: device.location.id,
    terminalId: device.terminal.id,
    userId: waiter!.id,
    approval: null,
    orderId: newId(),
    type: 'order.update',
    payload: { guestCount: 3 },
  };
  const pushed = await request.post('/api/v1/sync/push', {
    headers: { 'x-terminal-token': device.deviceToken },
    data: { operations: [operation] },
  });
  const { results } = (await pushed.json()) as { results: { status: string }[] };
  expect(results[0]!.status).toBe('conflict');

  // The manager reviews it in the backoffice.
  const manager = DEMO_USERS.find((user) => user.email?.startsWith('manager@'))!;
  await page.goto('/login');
  await page.getByLabel('E-Mail').fill(manager.email!);
  await page.getByLabel('Passwort').fill(DEMO_BACKOFFICE_PASSWORD);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/\/backoffice/);
  await page.goto('/backoffice/sync-conflicts');
  await expect(page.getByRole('heading', { name: 'Synchronisationskonflikte' })).toBeVisible();
  const open = page.getByRole('button', { name: 'Erledigt', exact: true });
  const before = await open.count();
  expect(before).toBeGreaterThan(0);

  await open.first().click();
  const dialog = page.getByRole('dialog', { name: 'Konflikt als erledigt markieren' });
  await dialog.getByLabel('Notiz').fill('Bestellung nie eröffnet, nichts zu tun');
  await dialog.getByRole('button', { name: 'Erledigt' }).click();
  await expect(page.getByText('Konflikt als erledigt markiert.')).toBeVisible();
  await expect(open).toHaveCount(before - 1);
});
