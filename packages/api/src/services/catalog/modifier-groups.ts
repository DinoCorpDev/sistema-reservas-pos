import {
  ALLERGENS,
  type createModifierGroupSchema,
  newId,
  type nameTranslationsSchema,
  type replaceModifiersSchema,
  type updateModifierGroupSchema,
} from '@pos/core';
import { type Database, inOrg, notDeleted, ownedByOrg, runCommand, schema as s } from '@pos/db';
import { asc, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';
import { type Actor, assertPermission } from '../../actor';
import { ApiError, notFound } from '../../errors';
import { definedOnly, type ServiceDeps } from '../shared';
import {
  assertCatalogRead,
  desiredLabels,
  desiredTexts,
  labelsOf,
  loadTranslations,
  planReplace,
  replaceTranslations,
} from './common';

// ── Modifier groups and modifiers (RF-B02, RF-B05, RF-B07) ──────────────────

const allergenOrder = (allergen: string) => (ALLERGENS as readonly string[]).indexOf(allergen);

/** Groups with their live modifiers, allergens and translations; all groups when `ids` is omitted. */
async function buildModifierGroupDtos(db: Database, actor: Actor, ids?: string[]) {
  const groups = await db
    .select()
    .from(s.modifierGroups)
    .where(
      inOrg(
        s.modifierGroups,
        actor,
        ids ? inArray(s.modifierGroups.id, ids) : undefined,
        notDeleted(s.modifierGroups),
      ),
    )
    .orderBy(asc(s.modifierGroups.sortOrder), asc(s.modifierGroups.name));
  if (groups.length === 0) return [];
  const groupIds = groups.map((g) => g.id);
  const modifiers = await db
    .select()
    .from(s.modifiers)
    .where(inOrg(s.modifiers, actor, inArray(s.modifiers.modifierGroupId, groupIds), notDeleted(s.modifiers)))
    .orderBy(asc(s.modifiers.sortOrder), asc(s.modifiers.name));
  const modifierIds = modifiers.map((m) => m.id);
  const allergens =
    modifierIds.length === 0
      ? []
      : await db
          .select()
          .from(s.modifierAllergens)
          .where(
            inOrg(
              s.modifierAllergens,
              actor,
              inArray(s.modifierAllergens.modifierId, modifierIds),
              notDeleted(s.modifierAllergens),
            ),
          );
  const translations = await loadTranslations(db, actor, ['modifier_group', 'modifier'], [...groupIds, ...modifierIds]);

  return groups.map((group) => ({
    id: group.id,
    name: group.name,
    minSelect: group.minSelect,
    maxSelect: group.maxSelect,
    sortOrder: group.sortOrder,
    isActive: group.isActive,
    translations: translations.get(group.id) ?? {},
    modifiers: modifiers
      .filter((m) => m.modifierGroupId === group.id)
      .map((m) => ({
        id: m.id,
        name: m.name,
        priceDeltaRappen: m.priceDeltaRappen,
        sortOrder: m.sortOrder,
        isActive: m.isActive,
        allergens: allergens
          .filter((a) => a.modifierId === m.id)
          .map((a) => ({ allergen: a.allergen, presence: a.presence }))
          .sort((a, b) => allergenOrder(a.allergen) - allergenOrder(b.allergen)),
        translations: labelsOf(translations.get(m.id)),
      })),
  }));
}
export type ModifierGroupDto = Awaited<ReturnType<typeof buildModifierGroupDtos>>[number];

async function loadGroup(db: Database, actor: Actor, id: string) {
  const [row] = await db
    .select()
    .from(s.modifierGroups)
    .where(inOrg(s.modifierGroups, actor, eq(s.modifierGroups.id, id), notDeleted(s.modifierGroups)));
  if (!row) throw notFound('Modifier group');
  return row;
}

async function groupDto(db: Database, actor: Actor, id: string): Promise<ModifierGroupDto> {
  const [dto] = await buildModifierGroupDtos(db, actor, [id]);
  if (!dto) throw notFound('Modifier group');
  return dto;
}

export async function listModifierGroups(deps: ServiceDeps, actor: Actor): Promise<ModifierGroupDto[]> {
  assertCatalogRead(actor);
  return buildModifierGroupDtos(deps.db, actor);
}

export async function getModifierGroup(deps: ServiceDeps, actor: Actor, id: string): Promise<ModifierGroupDto> {
  assertCatalogRead(actor);
  return groupDto(deps.db, actor, id);
}

export async function createModifierGroup(
  deps: ServiceDeps,
  actor: Actor,
  input: z.output<typeof createModifierGroupSchema>,
): Promise<ModifierGroupDto> {
  assertPermission(actor, 'catalog.manage');
  const id = newId();
  await deps.db.insert(s.modifierGroups).values(ownedByOrg(actor, { ...input, id }));
  return groupDto(deps.db, actor, id);
}

export async function updateModifierGroup(
  deps: ServiceDeps,
  actor: Actor,
  id: string,
  input: z.output<typeof updateModifierGroupSchema>,
): Promise<ModifierGroupDto> {
  assertPermission(actor, 'catalog.manage');
  const current = await loadGroup(deps.db, actor, id);
  const patch = definedOnly(input);
  const minSelect = patch.minSelect ?? current.minSelect;
  const maxSelect = patch.maxSelect ?? current.maxSelect;
  if (minSelect > maxSelect) {
    throw new ApiError('VALIDATION_FAILED', 'minSelect must not exceed maxSelect', { path: ['minSelect'] });
  }
  if (Object.keys(patch).length > 0) {
    await deps.db
      .update(s.modifierGroups)
      .set(patch)
      .where(inOrg(s.modifierGroups, actor, eq(s.modifierGroups.id, id)));
  }
  return groupDto(deps.db, actor, id);
}

/** Soft delete (PA-06) of the group and its modifiers, only when no product uses it. */
export async function deleteModifierGroup(deps: ServiceDeps, actor: Actor, id: string): Promise<void> {
  assertPermission(actor, 'catalog.manage');
  await loadGroup(deps.db, actor, id);
  const [link] = await deps.db
    .select({ id: s.productModifierGroups.id })
    .from(s.productModifierGroups)
    .where(
      inOrg(
        s.productModifierGroups,
        actor,
        eq(s.productModifierGroups.modifierGroupId, id),
        notDeleted(s.productModifierGroups),
      ),
    )
    .limit(1);
  if (link) {
    throw new ApiError('CONFLICT', 'Products still use this modifier group; remove it from them, or deactivate it');
  }
  await runCommand(deps.db, actor, async (tx) => {
    const deletedAt = new Date();
    await tx
      .update(s.modifierGroups)
      .set({ deletedAt, isActive: false })
      .where(inOrg(s.modifierGroups, actor, eq(s.modifierGroups.id, id)));
    await tx
      .update(s.modifiers)
      .set({ deletedAt, isActive: false })
      .where(inOrg(s.modifiers, actor, eq(s.modifiers.modifierGroupId, id), notDeleted(s.modifiers)));
  });
}

/** Replaces the modifiers of a group. A changed surcharge is a price change (RF-B17). */
export async function replaceModifiers(
  deps: ServiceDeps,
  actor: Actor,
  groupId: string,
  input: z.output<typeof replaceModifiersSchema>,
): Promise<ModifierGroupDto> {
  assertPermission(actor, 'catalog.manage');
  await loadGroup(deps.db, actor, groupId);
  const existing = await deps.db
    .select()
    .from(s.modifiers)
    .where(inOrg(s.modifiers, actor, eq(s.modifiers.modifierGroupId, groupId)));
  const items = input.modifiers.map((m, index) => ({ ...m, sortOrder: m.sortOrder ?? index }));
  const plan = planReplace(existing, items, (row) => row.id, (item) => item.id ?? null);
  const inserts = plan.insert.map((item) => ({ ...item, id: item.id ?? newId() }));
  const bySortOrder = (a: { sortOrder: number }, b: { sortOrder: number }) => a.sortOrder - b.sortOrder;
  const after = [...plan.update.map(([row, item]) => ({ ...item, id: row.id })), ...inserts].sort(bySortOrder);

  const live = existing.filter((row) => row.deletedAt === null).sort(bySortOrder);
  const priceBefore = new Map(live.map((row) => [row.id, row.priceDeltaRappen]));
  const priceChanged = after.some((m) => (priceBefore.get(m.id) ?? 0) !== m.priceDeltaRappen);
  if (priceChanged) assertPermission(actor, 'catalog.price_change');

  const allergenRows =
    after.length === 0
      ? []
      : await deps.db
          .select()
          .from(s.modifierAllergens)
          .where(
            inOrg(
              s.modifierAllergens,
              actor,
              inArray(
                s.modifierAllergens.modifierId,
                after.map((m) => m.id),
              ),
            ),
          );

  await runCommand(deps.db, actor, async (tx, recorder) => {
    for (const [row, item] of plan.update) {
      await tx
        .update(s.modifiers)
        .set({
          name: item.name,
          priceDeltaRappen: item.priceDeltaRappen,
          sortOrder: item.sortOrder,
          isActive: item.isActive,
          deletedAt: null,
        })
        .where(inOrg(s.modifiers, actor, eq(s.modifiers.id, row.id)));
    }
    if (inserts.length > 0) {
      await tx.insert(s.modifiers).values(
        inserts.map((item) =>
          ownedByOrg(actor, {
            id: item.id,
            modifierGroupId: groupId,
            name: item.name,
            priceDeltaRappen: item.priceDeltaRappen,
            sortOrder: item.sortOrder,
            isActive: item.isActive,
          }),
        ),
      );
    }
    if (plan.remove.length > 0) {
      await tx
        .update(s.modifiers)
        .set({ deletedAt: new Date(), isActive: false })
        .where(
          inOrg(
            s.modifiers,
            actor,
            inArray(
              s.modifiers.id,
              plan.remove.map((row) => row.id),
            ),
          ),
        );
    }
    for (const modifier of after) {
      const rows = allergenRows.filter((a) => a.modifierId === modifier.id);
      const allergenPlan = planReplace(rows, modifier.allergens, (row) => row.allergen, (item) => item.allergen);
      for (const [row, item] of allergenPlan.update) {
        if (row.presence === item.presence && row.deletedAt === null) continue;
        await tx
          .update(s.modifierAllergens)
          .set({ presence: item.presence, deletedAt: null })
          .where(inOrg(s.modifierAllergens, actor, eq(s.modifierAllergens.id, row.id)));
      }
      if (allergenPlan.insert.length > 0) {
        await tx
          .insert(s.modifierAllergens)
          .values(allergenPlan.insert.map((item) => ownedByOrg(actor, { modifierId: modifier.id, ...item })));
      }
      if (allergenPlan.remove.length > 0) {
        await tx
          .update(s.modifierAllergens)
          .set({ deletedAt: new Date() })
          .where(
            inOrg(
              s.modifierAllergens,
              actor,
              inArray(
                s.modifierAllergens.id,
                allergenPlan.remove.map((row) => row.id),
              ),
            ),
          );
      }
      if (modifier.translations) {
        await replaceTranslations(tx, actor, 'modifier', modifier.id, desiredLabels(modifier.translations));
      }
    }
    if (priceChanged) {
      const summary = (list: readonly { id: string; name: string; priceDeltaRappen: number }[]) =>
        list.map(({ id, name, priceDeltaRappen }) => ({ id, name, priceDeltaRappen }));
      recorder.audit({
        action: 'catalog.price_changed',
        entityType: 'modifier_group',
        entityId: groupId,
        locationId: null,
        before: { modifiers: summary(live) },
        after: { modifiers: summary(after) },
      });
    }
  });
  return groupDto(deps.db, actor, groupId);
}

export async function replaceModifierGroupTranslations(
  deps: ServiceDeps,
  actor: Actor,
  id: string,
  input: z.output<typeof nameTranslationsSchema>,
): Promise<ModifierGroupDto> {
  assertPermission(actor, 'catalog.manage');
  await loadGroup(deps.db, actor, id);
  await runCommand(deps.db, actor, (tx) =>
    replaceTranslations(tx, actor, 'modifier_group', id, desiredTexts(input, ['name'])),
  );
  return groupDto(deps.db, actor, id);
}
