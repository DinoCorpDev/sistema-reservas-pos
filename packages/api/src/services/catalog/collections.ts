import {
  newId,
  type productLocationSettingsSchema,
  type replaceAllergensSchema,
  type replaceAvailabilitySchema,
  type replaceChannelPricesSchema,
  type replaceOriginsSchema,
  type replaceProductModifierGroupsSchema,
  type replaceProductStationsSchema,
  type replaceVariantsSchema,
  type TextTranslationsInput,
} from '@pos/core';
import {
  inLocation,
  inOrg,
  notDeleted,
  ownedByLocation,
  ownedByOrg,
  runCommand,
  schema as s,
} from '@pos/db';
import { eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';
import { type Actor, assertPermission, requireLocationId } from '../../actor';
import { notFound } from '../../errors';
import type { ServiceDeps } from '../shared';
import {
  assertLocationsExist,
  desiredLabels,
  desiredTexts,
  loadProductRow,
  planReplace,
  productUpdatedEvent,
  replaceTranslations,
} from './common';
import { buildProductDto, type ProductDto } from './products';

/**
 * PUT endpoints that replace one collection of a product as a whole (RF-B02…RF-B11): matching
 * rows are updated, new ones inserted and the rest soft-deleted, in one transaction.
 */

const softDeleted = () => ({ deletedAt: new Date() });
const ids = (rows: readonly { id: string }[]) => rows.map((row) => row.id);

// ── Variants (RF-B02, RF-B04) ───────────────────────────────────────────────

export async function replaceVariants(
  deps: ServiceDeps,
  actor: Actor,
  productId: string,
  input: z.output<typeof replaceVariantsSchema>,
): Promise<ProductDto> {
  assertPermission(actor, 'catalog.manage');
  const product = await loadProductRow(deps.db, actor, productId);
  const existing = await deps.db
    .select()
    .from(s.productVariants)
    .where(inOrg(s.productVariants, actor, eq(s.productVariants.productId, productId)));

  const items = input.variants.map((v, index) => ({ ...v, sortOrder: v.sortOrder ?? index }));
  // Exactly one default variant: the flagged one, otherwise the first active one.
  if (items.length > 0 && !items.some((v) => v.isDefault)) {
    (items.find((v) => v.isActive) ?? items[0]!).isDefault = true;
  }
  const plan = planReplace(existing, items, (row) => row.id, (item) => item.id ?? null);
  const inserts = plan.insert.map((item) => ({ ...item, id: item.id ?? newId() }));
  const after = [...plan.update.map(([row, item]) => ({ ...item, id: row.id })), ...inserts].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );

  const live = existing.filter((row) => row.deletedAt === null).sort((a, b) => a.sortOrder - b.sortOrder);
  const priceBefore = new Map(live.map((row) => [row.id, row.priceRappen]));
  const defaultVariant = after.find((v) => v.isDefault);
  // With variants, the catalog price is the default variant's price (schema comment).
  const basePriceRappen = defaultVariant?.priceRappen ?? product.basePriceRappen;
  const priceChanged =
    basePriceRappen !== product.basePriceRappen ||
    after.some((v) => priceBefore.get(v.id) !== v.priceRappen);
  if (priceChanged) assertPermission(actor, 'catalog.price_change');

  await runCommand(deps.db, actor, async (tx, recorder) => {
    for (const [row, item] of plan.update) {
      await tx
        .update(s.productVariants)
        .set({
          name: item.name,
          priceRappen: item.priceRappen,
          isDefault: item.isDefault,
          sortOrder: item.sortOrder,
          isActive: item.isActive,
          deletedAt: null,
        })
        .where(inOrg(s.productVariants, actor, eq(s.productVariants.id, row.id)));
    }
    if (inserts.length > 0) {
      await tx.insert(s.productVariants).values(
        inserts.map((item) =>
          ownedByOrg(actor, {
            id: item.id,
            productId,
            name: item.name,
            priceRappen: item.priceRappen,
            isDefault: item.isDefault,
            sortOrder: item.sortOrder,
            isActive: item.isActive,
          }),
        ),
      );
    }
    if (plan.remove.length > 0) {
      await tx
        .update(s.productVariants)
        .set(softDeleted())
        .where(inOrg(s.productVariants, actor, inArray(s.productVariants.id, ids(plan.remove))));
      // Channel prices of a removed variant go with it.
      await tx
        .update(s.channelPrices)
        .set(softDeleted())
        .where(
          inOrg(
            s.channelPrices,
            actor,
            inArray(s.channelPrices.variantId, ids(plan.remove)),
            notDeleted(s.channelPrices),
          ),
        );
    }
    for (const item of after) {
      if (item.translations) {
        await replaceTranslations(tx, actor, 'product_variant', item.id, desiredLabels(item.translations));
      }
    }
    if (basePriceRappen !== product.basePriceRappen) {
      await tx
        .update(s.products)
        .set({ basePriceRappen })
        .where(inOrg(s.products, actor, eq(s.products.id, productId)));
    }
    if (priceChanged) {
      const summary = (list: readonly { id: string; name: string; priceRappen: number }[]) =>
        list.map(({ id, name, priceRappen }) => ({ id, name, priceRappen }));
      recorder.audit({
        action: 'catalog.price_changed',
        entityType: 'product',
        entityId: productId,
        locationId: null,
        before: { basePriceRappen: product.basePriceRappen, variants: summary(live) },
        after: { basePriceRappen, variants: summary(after) },
      });
    }
    recorder.event(productUpdatedEvent(productId, ['variants']));
  });
  return buildProductDto(deps, actor, productId);
}

// ── Allergens (RF-B05, RN-18) ───────────────────────────────────────────────

export async function replaceAllergens(
  deps: ServiceDeps,
  actor: Actor,
  productId: string,
  input: z.output<typeof replaceAllergensSchema>,
): Promise<ProductDto> {
  assertPermission(actor, 'catalog.manage');
  const product = await loadProductRow(deps.db, actor, productId);
  const existing = await deps.db
    .select()
    .from(s.productAllergens)
    .where(inOrg(s.productAllergens, actor, eq(s.productAllergens.productId, productId)));
  const plan = planReplace(existing, input.allergens, (row) => row.allergen, (item) => item.allergen);
  const live = existing.filter((row) => row.deletedAt === null);
  const summary = (list: readonly { allergen: string; presence: string }[]) =>
    list.map(({ allergen, presence }) => ({ allergen, presence }));

  await runCommand(deps.db, actor, async (tx, recorder) => {
    for (const [row, item] of plan.update) {
      if (row.presence === item.presence && row.deletedAt === null) continue;
      await tx
        .update(s.productAllergens)
        .set({ presence: item.presence, deletedAt: null })
        .where(inOrg(s.productAllergens, actor, eq(s.productAllergens.id, row.id)));
    }
    if (plan.insert.length > 0) {
      await tx
        .insert(s.productAllergens)
        .values(plan.insert.map((item) => ownedByOrg(actor, { productId, ...item })));
    }
    if (plan.remove.length > 0) {
      await tx
        .update(s.productAllergens)
        .set(softDeleted())
        .where(inOrg(s.productAllergens, actor, inArray(s.productAllergens.id, ids(plan.remove))));
    }
    if (product.allergensComplete !== input.confirmed) {
      await tx
        .update(s.products)
        .set({ allergensComplete: input.confirmed })
        .where(inOrg(s.products, actor, eq(s.products.id, productId)));
    }
    recorder.audit({
      action: 'catalog.product_updated',
      entityType: 'product',
      entityId: productId,
      locationId: null,
      before: { allergens: summary(live), allergensComplete: product.allergensComplete },
      after: { allergens: summary(input.allergens), allergensComplete: input.confirmed },
    });
    recorder.event(productUpdatedEvent(productId, ['allergens']));
  });
  return buildProductDto(deps, actor, productId);
}

// ── Origins (RF-B06, RN-18) ─────────────────────────────────────────────────

export async function replaceOrigins(
  deps: ServiceDeps,
  actor: Actor,
  productId: string,
  input: z.output<typeof replaceOriginsSchema>,
): Promise<ProductDto> {
  assertPermission(actor, 'catalog.manage');
  await loadProductRow(deps.db, actor, productId);
  const existing = await deps.db
    .select()
    .from(s.productOrigins)
    .where(inOrg(s.productOrigins, actor, eq(s.productOrigins.productId, productId)));
  const plan = planReplace(existing, input.origins, (row) => row.id, (item) => item.id ?? null);
  const summary = (list: readonly { kind: string; species: string | null; country: string }[]) =>
    list.map(({ kind, species, country }) => ({ kind, species, country }));

  await runCommand(deps.db, actor, async (tx, recorder) => {
    for (const [row, item] of plan.update) {
      await tx
        .update(s.productOrigins)
        .set({ kind: item.kind, species: item.species, country: item.country, deletedAt: null })
        .where(inOrg(s.productOrigins, actor, eq(s.productOrigins.id, row.id)));
    }
    if (plan.insert.length > 0) {
      await tx.insert(s.productOrigins).values(
        plan.insert.map((item) =>
          ownedByOrg(actor, {
            id: item.id ?? newId(),
            productId,
            kind: item.kind,
            species: item.species,
            country: item.country,
          }),
        ),
      );
    }
    if (plan.remove.length > 0) {
      await tx
        .update(s.productOrigins)
        .set(softDeleted())
        .where(inOrg(s.productOrigins, actor, inArray(s.productOrigins.id, ids(plan.remove))));
    }
    recorder.audit({
      action: 'catalog.product_updated',
      entityType: 'product',
      entityId: productId,
      locationId: null,
      before: { origins: summary(existing.filter((row) => row.deletedAt === null)) },
      after: { origins: summary(input.origins) },
    });
    recorder.event(productUpdatedEvent(productId, ['origins']));
  });
  return buildProductDto(deps, actor, productId);
}

// ── Translations (RF-B07) ───────────────────────────────────────────────────

export async function replaceProductTranslations(
  deps: ServiceDeps,
  actor: Actor,
  productId: string,
  input: TextTranslationsInput,
): Promise<ProductDto> {
  assertPermission(actor, 'catalog.manage');
  await loadProductRow(deps.db, actor, productId);
  await runCommand(deps.db, actor, async (tx, recorder) => {
    const changed = await replaceTranslations(
      tx,
      actor,
      'product',
      productId,
      desiredTexts(input, ['name', 'description']),
    );
    if (changed) recorder.event(productUpdatedEvent(productId, ['translations']));
  });
  return buildProductDto(deps, actor, productId);
}

// ── Modifier groups of the product (RF-B02) ─────────────────────────────────

export async function replaceProductModifierGroups(
  deps: ServiceDeps,
  actor: Actor,
  productId: string,
  input: z.output<typeof replaceProductModifierGroupsSchema>,
): Promise<ProductDto> {
  assertPermission(actor, 'catalog.manage');
  await loadProductRow(deps.db, actor, productId);
  const wanted = input.modifierGroupIds;
  if (wanted.length > 0) {
    const groups = await deps.db
      .select({ id: s.modifierGroups.id })
      .from(s.modifierGroups)
      .where(inOrg(s.modifierGroups, actor, inArray(s.modifierGroups.id, wanted), notDeleted(s.modifierGroups)));
    if (groups.length !== wanted.length) throw notFound('Modifier group');
  }
  const existing = await deps.db
    .select()
    .from(s.productModifierGroups)
    .where(inOrg(s.productModifierGroups, actor, eq(s.productModifierGroups.productId, productId)));
  const items = wanted.map((modifierGroupId, sortOrder) => ({ modifierGroupId, sortOrder }));
  const plan = planReplace(existing, items, (row) => row.modifierGroupId, (item) => item.modifierGroupId);

  await runCommand(deps.db, actor, async (tx, recorder) => {
    for (const [row, item] of plan.update) {
      if (row.sortOrder === item.sortOrder && row.deletedAt === null) continue;
      await tx
        .update(s.productModifierGroups)
        .set({ sortOrder: item.sortOrder, deletedAt: null })
        .where(inOrg(s.productModifierGroups, actor, eq(s.productModifierGroups.id, row.id)));
    }
    if (plan.insert.length > 0) {
      await tx
        .insert(s.productModifierGroups)
        .values(plan.insert.map((item) => ownedByOrg(actor, { productId, ...item })));
    }
    if (plan.remove.length > 0) {
      await tx
        .update(s.productModifierGroups)
        .set(softDeleted())
        .where(inOrg(s.productModifierGroups, actor, inArray(s.productModifierGroups.id, ids(plan.remove))));
    }
    recorder.event(productUpdatedEvent(productId, ['modifierGroups']));
  });
  return buildProductDto(deps, actor, productId);
}

// ── Availability (RF-B08, RN-17) ────────────────────────────────────────────

const withSeconds = (time: string | null) => (time && time.length === 5 ? `${time}:00` : time);

export async function replaceAvailability(
  deps: ServiceDeps,
  actor: Actor,
  productId: string,
  input: z.output<typeof replaceAvailabilitySchema>,
): Promise<ProductDto> {
  assertPermission(actor, 'catalog.manage');
  await loadProductRow(deps.db, actor, productId);
  await assertLocationsExist(
    deps.db,
    actor,
    input.rules.map((rule) => rule.locationId),
  );
  const existing = await deps.db
    .select()
    .from(s.availabilityRules)
    .where(inOrg(s.availabilityRules, actor, eq(s.availabilityRules.productId, productId)));
  const items = input.rules.map((rule) => ({
    ...rule,
    startTime: withSeconds(rule.startTime),
    endTime: withSeconds(rule.endTime),
  }));
  const plan = planReplace(existing, items, (row) => row.id, (item) => item.id ?? null);
  type RuleValues = Omit<(typeof items)[number], 'id' | 'channel'> & { channel: string | null };
  const values = (item: RuleValues) => ({
    locationId: item.locationId,
    categoryId: null,
    channel: item.channel,
    daysOfWeek: item.daysOfWeek,
    startTime: item.startTime,
    endTime: item.endTime,
    validFrom: item.validFrom,
    validTo: item.validTo,
  });

  await runCommand(deps.db, actor, async (tx, recorder) => {
    for (const [row, item] of plan.update) {
      await tx
        .update(s.availabilityRules)
        .set({ ...values(item), deletedAt: null })
        .where(inOrg(s.availabilityRules, actor, eq(s.availabilityRules.id, row.id)));
    }
    if (plan.insert.length > 0) {
      await tx
        .insert(s.availabilityRules)
        .values(
          plan.insert.map((item) => ownedByOrg(actor, { id: item.id ?? newId(), productId, ...values(item) })),
        );
    }
    if (plan.remove.length > 0) {
      await tx
        .update(s.availabilityRules)
        .set(softDeleted())
        .where(inOrg(s.availabilityRules, actor, inArray(s.availabilityRules.id, ids(plan.remove))));
    }
    recorder.audit({
      action: 'catalog.availability_changed',
      entityType: 'product',
      entityId: productId,
      locationId: null,
      before: { rules: existing.filter((row) => row.deletedAt === null).map(values) },
      after: { rules: items.map(values) },
    });
    recorder.event(productUpdatedEvent(productId, ['availability']));
  });
  return buildProductDto(deps, actor, productId);
}

// ── Channel prices (RF-B04) ─────────────────────────────────────────────────

export async function replaceChannelPrices(
  deps: ServiceDeps,
  actor: Actor,
  productId: string,
  input: z.output<typeof replaceChannelPricesSchema>,
): Promise<ProductDto> {
  assertPermission(actor, 'catalog.manage');
  await loadProductRow(deps.db, actor, productId);
  await assertLocationsExist(
    deps.db,
    actor,
    input.prices.map((price) => price.locationId),
  );
  const variantIds = [...new Set(input.prices.map((p) => p.variantId).filter((id): id is string => !!id))];
  if (variantIds.length > 0) {
    const variants = await deps.db
      .select({ id: s.productVariants.id })
      .from(s.productVariants)
      .where(
        inOrg(
          s.productVariants,
          actor,
          eq(s.productVariants.productId, productId),
          inArray(s.productVariants.id, variantIds),
          notDeleted(s.productVariants),
        ),
      );
    if (variants.length !== variantIds.length) throw notFound('Variant');
  }

  const existing = await deps.db
    .select()
    .from(s.channelPrices)
    .where(inOrg(s.channelPrices, actor, eq(s.channelPrices.productId, productId)));
  const key = (p: { channel: string; locationId: string | null; variantId: string | null }) =>
    `${p.channel}|${p.locationId}|${p.variantId}`;
  const plan = planReplace(existing, input.prices, key, key);
  type PriceValues = { channel: string; locationId: string | null; variantId: string | null; priceRappen: number };
  const summary = (list: readonly PriceValues[]) =>
    list
      .map(({ channel, locationId, variantId, priceRappen }) => ({ channel, locationId, variantId, priceRappen }))
      .sort((a, b) => key(a).localeCompare(key(b)));
  const before = summary(existing.filter((row) => row.deletedAt === null));
  const after = summary(input.prices);
  const changed = JSON.stringify(before) !== JSON.stringify(after);
  if (changed) assertPermission(actor, 'catalog.price_change');

  await runCommand(deps.db, actor, async (tx, recorder) => {
    for (const [row, item] of plan.update) {
      if (row.priceRappen === item.priceRappen && row.deletedAt === null) continue;
      await tx
        .update(s.channelPrices)
        .set({ priceRappen: item.priceRappen, deletedAt: null })
        .where(inOrg(s.channelPrices, actor, eq(s.channelPrices.id, row.id)));
    }
    if (plan.insert.length > 0) {
      await tx
        .insert(s.channelPrices)
        .values(plan.insert.map((item) => ownedByOrg(actor, { productId, ...item })));
    }
    if (plan.remove.length > 0) {
      await tx
        .update(s.channelPrices)
        .set(softDeleted())
        .where(inOrg(s.channelPrices, actor, inArray(s.channelPrices.id, ids(plan.remove))));
    }
    if (changed) {
      recorder.audit({
        action: 'catalog.price_changed',
        entityType: 'product',
        entityId: productId,
        locationId: null,
        before: { channelPrices: before },
        after: { channelPrices: after },
      });
      recorder.event(productUpdatedEvent(productId, ['channelPrices']));
    }
  });
  return buildProductDto(deps, actor, productId);
}

// ── Kitchen station routing at the current location (RF-B11) ────────────────

export async function replaceProductStations(
  deps: ServiceDeps,
  actor: Actor,
  productId: string,
  input: z.output<typeof replaceProductStationsSchema>,
): Promise<ProductDto> {
  assertPermission(actor, 'catalog.manage');
  const locationId = requireLocationId(actor);
  await loadProductRow(deps.db, actor, productId);
  const wanted = input.stationIds;
  if (wanted.length > 0) {
    const stations = await deps.db
      .select({ id: s.kitchenStations.id })
      .from(s.kitchenStations)
      .where(
        inLocation(s.kitchenStations, actor, inArray(s.kitchenStations.id, wanted), notDeleted(s.kitchenStations)),
      );
    if (stations.length !== wanted.length) throw notFound('Kitchen station');
  }
  const existing = await deps.db
    .select()
    .from(s.productStationRoutes)
    .where(inLocation(s.productStationRoutes, actor, eq(s.productStationRoutes.productId, productId)));
  const items = wanted.map((kitchenStationId) => ({ kitchenStationId }));
  const plan = planReplace(existing, items, (row) => row.kitchenStationId, (item) => item.kitchenStationId);

  await runCommand(deps.db, actor, async (tx, recorder) => {
    const revive = plan.update.filter(([row]) => row.deletedAt !== null).map(([row]) => row);
    if (revive.length > 0) {
      await tx
        .update(s.productStationRoutes)
        .set({ deletedAt: null })
        .where(inLocation(s.productStationRoutes, actor, inArray(s.productStationRoutes.id, ids(revive))));
    }
    if (plan.insert.length > 0) {
      await tx
        .insert(s.productStationRoutes)
        .values(plan.insert.map((item) => ownedByLocation(actor, { productId, ...item })));
    }
    if (plan.remove.length > 0) {
      await tx
        .update(s.productStationRoutes)
        .set(softDeleted())
        .where(inLocation(s.productStationRoutes, actor, inArray(s.productStationRoutes.id, ids(plan.remove))));
    }
    recorder.event(productUpdatedEvent(productId, ['stations'], locationId));
  });
  return buildProductDto(deps, actor, productId);
}

// ── The product at the current location (RF-B01) ───────────────────────────

/** The product's settings row at the actor's location, soft-deleted included (unique index). */
export async function loadSettingRow(deps: ServiceDeps, actor: Actor, productId: string) {
  const [row] = await deps.db
    .select()
    .from(s.productLocationSettings)
    .where(inLocation(s.productLocationSettings, actor, eq(s.productLocationSettings.productId, productId)));
  return row ?? null;
}

export async function updateProductLocationSettings(
  deps: ServiceDeps,
  actor: Actor,
  productId: string,
  input: z.output<typeof productLocationSettingsSchema>,
): Promise<ProductDto> {
  assertPermission(actor, 'catalog.manage');
  const locationId = requireLocationId(actor);
  await loadProductRow(deps.db, actor, productId);
  const row = await loadSettingRow(deps, actor, productId);
  const live = row && row.deletedAt === null ? row : null;
  const before = { isActive: live?.isActive ?? true, priceRappen: live?.priceRappen ?? null };
  const priceChanged = before.priceRappen !== input.priceRappen;
  if (priceChanged) assertPermission(actor, 'catalog.price_change');
  if (!priceChanged && before.isActive === input.isActive) return buildProductDto(deps, actor, productId);

  await runCommand(deps.db, actor, async (tx, recorder) => {
    if (row) {
      await tx
        .update(s.productLocationSettings)
        .set({
          ...input,
          deletedAt: null,
          ...(live ? {} : { soldOutAt: null, soldOutUntil: null, soldOutByUserId: null }),
        })
        .where(inLocation(s.productLocationSettings, actor, eq(s.productLocationSettings.id, row.id)));
    } else {
      await tx.insert(s.productLocationSettings).values(ownedByLocation(actor, { productId, ...input }));
    }
    const audit = { entityType: 'product', entityId: productId };
    if (priceChanged) {
      recorder.audit({
        action: 'catalog.price_changed',
        ...audit,
        before: { locationId, priceRappen: before.priceRappen },
        after: { locationId, priceRappen: input.priceRappen },
      });
    }
    if (before.isActive !== input.isActive) {
      recorder.audit({
        action: 'catalog.availability_changed',
        ...audit,
        before: { locationId, isActive: before.isActive },
        after: { locationId, isActive: input.isActive },
      });
    }
    recorder.event(productUpdatedEvent(productId, ['locationSettings'], locationId));
  });
  return buildProductDto(deps, actor, productId);
}
