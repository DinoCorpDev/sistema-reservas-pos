import { newId } from '@pos/core';
import { and, count, eq, isNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Database } from './client';
import { loadRootEnv, requireEnv } from './env';
import * as s from './schema';
import { seedDemoRestaurant } from './seed/demo';

/**
 * Integración contra MySQL real (requiere `pnpm db:setup`). Verifica que el seed del restaurante
 * demo quedó completo y que las tablas append-only rechazan cambios.
 */
loadRootEnv();

let db: Database;
let close: () => Promise<void>;
let organizationId: string;

beforeAll(async () => {
  const connection = createDb(requireEnv('DATABASE_URL'), { connectionLimit: 2 });
  db = connection.db;
  close = () => connection.pool.end();
  const result = await seedDemoRestaurant(db);
  organizationId = result.organizationId;
});

afterAll(async () => {
  await close();
});

const countWhere = async (
  table: typeof s.products | typeof s.diningTables | typeof s.areas,
  orgId: string,
) => {
  const [row] = await db.select({ n: count() }).from(table).where(eq(table.organizationId, orgId));
  return row?.n ?? 0;
};

describe('demo seed: Restaurant Demo Zürich', () => {
  it('is idempotent', async () => {
    const again = await seedDemoRestaurant(db);
    expect(again).toEqual({ status: 'skipped', organizationId });
  });

  it('creates one location in Zürich with German as venue and kitchen language', async () => {
    const rows = await db
      .select()
      .from(s.locations)
      .where(eq(s.locations.organizationId, organizationId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'Restaurant Demo Zürich',
      city: 'Zürich',
      defaultLanguage: 'de',
      kitchenLanguage: 'de',
      currency: 'CHF',
      vatUid: 'CHE-123.456.788 MWST',
    });
    expect(rows[0]?.settings.kitchen.alertAfterMinutes).toBe(12);
  });

  it('has 2 areas and 12 tables with unique QR codes', async () => {
    expect(await countWhere(s.areas, organizationId)).toBe(2);
    expect(await countWhere(s.diningTables, organizationId)).toBe(12);
    const codes = await db
      .select({ code: s.diningTables.qrCode })
      .from(s.diningTables)
      .where(eq(s.diningTables.organizationId, organizationId));
    expect(new Set(codes.map((c) => c.code)).size).toBe(12);
  });

  it('has 30 products, all with confirmed allergens and FR/IT/EN names', async () => {
    expect(await countWhere(s.products, organizationId)).toBe(30);
    const incomplete = await db
      .select({ id: s.products.id })
      .from(s.products)
      .where(
        and(eq(s.products.organizationId, organizationId), eq(s.products.allergensComplete, false)),
      );
    expect(incomplete).toHaveLength(0);

    const [names] = await db
      .select({ n: count() })
      .from(s.translations)
      .where(
        and(
          eq(s.translations.organizationId, organizationId),
          eq(s.translations.entityType, 'product'),
          eq(s.translations.field, 'name'),
        ),
      );
    expect(names?.n).toBe(30 * 3);
  });

  it('declares origin for every product that requires it (RN-18)', async () => {
    const missing = await db
      .select({ id: s.products.id })
      .from(s.products)
      .leftJoin(s.productOrigins, eq(s.productOrigins.productId, s.products.id))
      .where(
        and(
          eq(s.products.organizationId, organizationId),
          eq(s.products.requiresOrigin, true),
          isNull(s.productOrigins.id),
        ),
      );
    expect(missing).toHaveLength(0);
  });

  it('stores the current Swiss VAT rates as dated data (RN-02)', async () => {
    const current = await db
      .select({ code: s.taxRates.code, rateBp: s.taxRates.rateBp })
      .from(s.taxRates)
      .where(and(eq(s.taxRates.organizationId, organizationId), isNull(s.taxRates.validTo)));
    expect(Object.fromEntries(current.map((r) => [r.code, r.rateBp]))).toEqual({
      normal: 810,
      reduced: 260,
      accommodation: 380,
    });
  });

  it('routes the daily menu to two stations (RF-C21)', async () => {
    const [product] = await db
      .select({ id: s.products.id })
      .from(s.products)
      .where(and(eq(s.products.organizationId, organizationId), eq(s.products.sku, 'TAGESMENUE')));
    const routes = await db
      .select()
      .from(s.productStationRoutes)
      .where(eq(s.productStationRoutes.productId, product!.id));
    expect(routes).toHaveLength(2);
  });
});

describe('append-only tables (RN-10)', () => {
  it.each(['audit_events', 'receipts', 'daily_closings'])(
    'has UPDATE and DELETE triggers on %s',
    async (table) => {
      const [rows] = (await db.execute(
        sql`SELECT EVENT_MANIPULATION AS event FROM information_schema.TRIGGERS
            WHERE TRIGGER_SCHEMA = DATABASE() AND EVENT_OBJECT_TABLE = ${table}`,
      )) as unknown as [{ event: string }[]];
      expect(rows.map((r) => r.event).sort()).toEqual(['DELETE', 'UPDATE']);
    },
  );

  it('rejects updating an audit event', async () => {
    const id = newId();
    await expect(
      db.transaction(async (tx) => {
        await tx.insert(s.auditEvents).values({
          id,
          organizationId,
          action: 'catalog.price_changed',
          entityType: 'product',
          occurredAt: new Date(),
          recordedAt: new Date(),
        });
        await tx.update(s.auditEvents).set({ reason: 'tampered' }).where(eq(s.auditEvents.id, id));
      }),
    ).rejects.toThrow(/append-only/);
    const leftovers = await db.select().from(s.auditEvents).where(eq(s.auditEvents.id, id));
    expect(leftovers).toHaveLength(0);
  });
});
