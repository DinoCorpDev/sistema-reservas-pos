import { createDb, schema as s } from '@pos/db';
import { testDatabaseUrl } from '@pos/db/testing';
import { expect, test } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { pairPos, unlockPos } from './pos-helpers';

/**
 * RF-F23: a change made in the backoffice reaches the terminals in less than a minute, without
 * touching them (the configuration version travels with every pull, docs/SYNC.md §12).
 */
test('a price change reaches the POS in less than a minute', async ({ page }) => {
  test.setTimeout(150_000);
  await pairPos(page, 'K1');
  await unlockPos(page, '4001');
  await page.getByRole('button', { name: 'Theke' }).click();
  await page.getByRole('button', { name: 'Vorspeisen', exact: true }).click();
  const soup = page.getByTestId('product').filter({ hasText: 'Tomatensuppe' });
  await expect(soup).toContainText('10.50');

  const { db, pool } = createDb(testDatabaseUrl(), { connectionLimit: 1 });
  try {
    // The same write the catalog editor does (new price, new updated_at).
    await db
      .update(s.products)
      .set({ basePriceRappen: 1250 })
      .where(eq(s.products.name, 'Tomatensuppe'));
    const changedAt = Date.now();
    await expect(soup).toContainText('12.50', { timeout: 60_000 });
    expect(Date.now() - changedAt).toBeLessThan(60_000);
  } finally {
    await db
      .update(s.products)
      .set({ basePriceRappen: 1050 })
      .where(eq(s.products.name, 'Tomatensuppe'));
    await pool.end();
  }
});
