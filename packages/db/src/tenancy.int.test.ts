import { newId } from '@pos/core';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Database } from './client';
import { publishPending } from './outbox';
import * as s from './schema';
import { applyOrganizationTemplate, newPinKey } from './templates/organization';
import { inLocation, inOrg, notDeleted, ownedByOrg, type TenantContext } from './tenant';
import { testDatabaseUrl } from './testing';
import { runCommand } from './unit-of-work';

let db: Database;
let close: () => Promise<void>;
let ctxA: TenantContext;
let ctxB: TenantContext;
let productA: string;
let productB: string;

/** A second, minimal organization next to the seeded demo restaurant. */
async function createOrganization(name: string) {
  const organizationId = newId();
  const locationId = newId();
  const categoryId = newId();
  const productId = newId();
  await db.transaction(async (tx) => {
    await tx.insert(s.organizations).values({
      id: organizationId,
      name,
      slug: `${name.toLowerCase().replace(/\W+/g, '-')}-${organizationId.slice(-6)}`,
      pinKey: newPinKey(),
    });
    await tx.insert(s.locations).values({
      id: locationId,
      organizationId,
      name,
      legalName: name,
      street: 'Teststrasse 1',
      postalCode: '3000',
      city: 'Bern',
      languages: ['de', 'fr'],
      settings: {} as never,
    });
    const { taxCategoryIds } = await applyOrganizationTemplate(tx, organizationId, 'de');
    await tx.insert(s.categories).values({ id: categoryId, organizationId, name: 'Kategorie' });
    await tx.insert(s.products).values({
      id: productId,
      organizationId,
      categoryId,
      taxCategoryId: taxCategoryIds.food,
      name: `Produkt ${name}`,
      basePriceRappen: 1000,
    });
  });
  return { ctx: { organizationId, locationId, userId: null } satisfies TenantContext, productId };
}

beforeAll(async () => {
  const connection = createDb(testDatabaseUrl(), { connectionLimit: 3 });
  db = connection.db;
  close = () => connection.pool.end();
  const a = await createOrganization('Org A');
  const b = await createOrganization('Org B');
  ctxA = a.ctx;
  ctxB = b.ctx;
  productA = a.productId;
  productB = b.productId;
});

afterAll(async () => {
  await close();
});

describe('RNF-12 · no query crosses organizations', () => {
  it('only lists the tenant’s own rows', async () => {
    const rows = await db
      .select({ id: s.products.id })
      .from(s.products)
      .where(inOrg(s.products, ctxA));
    expect(rows.map((r) => r.id)).toEqual([productA]);
  });

  it('cannot read another organization’s row even with its id', async () => {
    const rows = await db
      .select()
      .from(s.products)
      .where(inOrg(s.products, ctxA, eq(s.products.id, productB)));
    expect(rows).toHaveLength(0);
  });

  it('cannot update or soft-delete another organization’s row', async () => {
    const [result] = await db
      .update(s.products)
      .set({ name: 'hijacked', deletedAt: new Date() })
      .where(inOrg(s.products, ctxA, eq(s.products.id, productB)));
    expect(result.affectedRows).toBe(0);
    const [still] = await db.select().from(s.products).where(eq(s.products.id, productB));
    expect(still).toMatchObject({ name: 'Produkt Org B', deletedAt: null });
  });

  it('stamps the caller’s tenant on inserts, whatever the payload says', () => {
    const forged = { organizationId: ctxB.organizationId, name: 'x' };
    expect(ownedByOrg(ctxA, forged).organizationId).toBe(ctxA.organizationId);
  });

  it('scopes location data to the context’s location', async () => {
    const rows = await db
      .select({ id: s.locations.id })
      .from(s.locations)
      .where(
        and(
          eq(s.locations.organizationId, ctxA.organizationId),
          eq(s.locations.id, ctxA.locationId!),
        ),
      );
    expect(rows).toHaveLength(1);
    await expect(async () =>
      inLocation(s.areas, { organizationId: ctxA.organizationId }),
    ).rejects.toThrow(/needs a location/);
  });

  it('hides soft-deleted rows with notDeleted()', async () => {
    const rows = await db
      .select()
      .from(s.products)
      .where(inOrg(s.products, ctxB, notDeleted(s.products)));
    expect(rows).toHaveLength(1);
  });
});

describe('PA-10 · change, audit and event commit together', () => {
  it('writes audit and outbox rows in the same transaction as the change', async () => {
    const ctx: TenantContext = { ...ctxA, userId: null, requestId: 'test-commit' };
    await runCommand(db, ctx, async (tx, recorder) => {
      await tx
        .update(s.products)
        .set({ basePriceRappen: 1200 })
        .where(inOrg(s.products, ctx, eq(s.products.id, productA)));
      recorder.audit({
        action: 'catalog.price_changed',
        entityType: 'product',
        entityId: productA,
        before: { basePriceRappen: 1000 },
        after: { basePriceRappen: 1200 },
        locationId: null,
      });
      recorder.event({
        type: 'catalog.product_updated',
        aggregateType: 'product',
        aggregateId: productA,
        payload: { fields: ['basePriceRappen'] },
      });
    });
    const audits = await db
      .select()
      .from(s.auditEvents)
      .where(and(eq(s.auditEvents.entityId, productA), eq(s.auditEvents.requestId, 'test-commit')));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      organizationId: ctxA.organizationId,
      locationId: null,
      action: 'catalog.price_changed',
      before: { basePriceRappen: 1000 },
      after: { basePriceRappen: 1200 },
    });
    const events = await db
      .select()
      .from(s.outboxEvents)
      .where(
        and(
          eq(s.outboxEvents.aggregateId, productA),
          eq(s.outboxEvents.type, 'catalog.product_updated'),
        ),
      );
    expect(events).toHaveLength(1);
    expect(events[0]?.publishedAt).toBeNull();
  });

  it('leaves neither the change nor audit nor event behind when the command fails', async () => {
    const ctx: TenantContext = { ...ctxB, requestId: 'test-rollback' };
    await expect(
      runCommand(db, ctx, async (tx, recorder) => {
        await tx
          .update(s.products)
          .set({ basePriceRappen: 9999 })
          .where(inOrg(s.products, ctx, eq(s.products.id, productB)));
        recorder.audit({
          action: 'catalog.price_changed',
          entityType: 'product',
          entityId: productB,
        });
        recorder.event({
          type: 'catalog.product_updated',
          aggregateType: 'product',
          aggregateId: productB,
          payload: {},
        });
        throw new Error('validation failed after the update');
      }),
    ).rejects.toThrow('validation failed');
    const [product] = await db.select().from(s.products).where(eq(s.products.id, productB));
    expect(product?.basePriceRappen).toBe(1000);
    expect(
      await db.select().from(s.auditEvents).where(eq(s.auditEvents.requestId, 'test-rollback')),
    ).toHaveLength(0);
    expect(
      await db.select().from(s.outboxEvents).where(eq(s.outboxEvents.aggregateId, productB)),
    ).toHaveLength(0);
  });
});

describe('outbox publisher', () => {
  it('delivers pending events once and records failures as attempts', async () => {
    const delivered: string[] = [];
    const first = await publishPending(db, async (event) => {
      if (event.aggregateId === productA) delivered.push(event.id);
    });
    expect(first.published).toBeGreaterThanOrEqual(1);
    expect(delivered).toHaveLength(1);

    const again = await publishPending(db, async () => {
      throw new Error('should not be called for published events');
    });
    expect(again).toEqual({ published: 0, failed: 0 });

    await runCommand(db, ctxB, async (_tx, recorder) => {
      recorder.event({
        type: 'catalog.product_sold_out',
        aggregateType: 'product',
        aggregateId: productB,
        payload: {},
      });
    });
    const failing = await publishPending(db, async () => {
      throw new Error('consumer down');
    });
    expect(failing).toEqual({ published: 0, failed: 1 });
    const [event] = await db
      .select()
      .from(s.outboxEvents)
      .where(eq(s.outboxEvents.aggregateId, productB));
    expect(event).toMatchObject({ attempts: 1, lastError: 'consumer down', publishedAt: null });
  });
});
