import { type markSoldOutSchema, nextLocalTime } from '@pos/core';
import { inLocation, ownedByLocation, runCommand, schema as s } from '@pos/db';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import { type Actor, assertPermission, requireLocationId } from '../../actor';
import { ApiError } from '../../errors';
import { iso, type ServiceDeps } from '../shared';
import { loadSettingRow } from './collections';
import { loadActorLocation, loadProductRow } from './common';
import { buildProductDto, type ProductDto } from './products';

/** Start of the next business day for an "86" until tomorrow (local time). */
export const BUSINESS_DAY_STARTS_AT = '04:00';

/**
 * "86" (RF-B09, RN-17): the product stops being orderable at the current location at once, on
 * every channel, until `until` (automatic return) or until it is restored.
 */
export async function markSoldOut(
  deps: ServiceDeps,
  actor: Actor,
  productId: string,
  input: z.output<typeof markSoldOutSchema>,
): Promise<ProductDto> {
  assertPermission(actor, 'catalog.sold_out');
  const locationId = requireLocationId(actor);
  await loadProductRow(deps.db, actor, productId);
  const now = new Date();
  let until: Date | null = null;
  if (input.nextBusinessDay) {
    const location = await loadActorLocation(deps.db, actor, locationId);
    until = nextLocalTime(now, location.timezone, BUSINESS_DAY_STARTS_AT);
  } else if (input.until) {
    until = new Date(input.until);
    if (until <= now) {
      throw new ApiError('VALIDATION_FAILED', 'The return time must be in the future', {
        path: ['until'],
      });
    }
  }

  const row = await loadSettingRow(deps, actor, productId);
  const live = row && row.deletedAt === null ? row : null;
  const change = { soldOutAt: now, soldOutUntil: until, soldOutByUserId: actor.userId ?? null };
  await runCommand(deps.db, actor, async (tx, recorder) => {
    if (row) {
      await tx
        .update(s.productLocationSettings)
        .set({ ...change, ...(live ? {} : { isActive: true, priceRappen: null, deletedAt: null }) })
        .where(
          inLocation(s.productLocationSettings, actor, eq(s.productLocationSettings.id, row.id)),
        );
    } else {
      await tx
        .insert(s.productLocationSettings)
        .values(ownedByLocation(actor, { productId, ...change }));
    }
    recorder.audit({
      action: 'catalog.availability_changed',
      entityType: 'product',
      entityId: productId,
      before: { soldOutAt: iso(live?.soldOutAt), soldOutUntil: iso(live?.soldOutUntil) },
      after: { soldOutAt: now.toISOString(), soldOutUntil: iso(until) },
    });
    recorder.event({
      type: 'catalog.product_sold_out',
      aggregateType: 'product',
      aggregateId: productId,
      payload: { productId, locationId, soldOutAt: now.toISOString(), until: iso(until) },
    });
  });
  return buildProductDto(deps, actor, productId);
}

/** Available again at the current location (RF-B09). Idempotent. */
export async function restoreSoldOut(
  deps: ServiceDeps,
  actor: Actor,
  productId: string,
): Promise<ProductDto> {
  assertPermission(actor, 'catalog.sold_out');
  const locationId = requireLocationId(actor);
  await loadProductRow(deps.db, actor, productId);
  const row = await loadSettingRow(deps, actor, productId);
  if (row && row.deletedAt === null && row.soldOutAt) {
    await runCommand(deps.db, actor, async (tx, recorder) => {
      await tx
        .update(s.productLocationSettings)
        .set({ soldOutAt: null, soldOutUntil: null, soldOutByUserId: null })
        .where(
          inLocation(s.productLocationSettings, actor, eq(s.productLocationSettings.id, row.id)),
        );
      recorder.audit({
        action: 'catalog.availability_changed',
        entityType: 'product',
        entityId: productId,
        before: { soldOutAt: iso(row.soldOutAt), soldOutUntil: iso(row.soldOutUntil) },
        after: { soldOutAt: null, soldOutUntil: null },
      });
      recorder.event({
        type: 'catalog.product_available',
        aggregateType: 'product',
        aggregateId: productId,
        payload: { productId, locationId },
      });
    });
  }
  return buildProductDto(deps, actor, productId);
}
