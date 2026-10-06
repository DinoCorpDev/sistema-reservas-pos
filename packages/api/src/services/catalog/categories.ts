import {
  type createCategorySchema,
  newId,
  type TextTranslationsInput,
  type updateCategorySchema,
} from '@pos/core';
import { type Database, inOrg, notDeleted, ownedByOrg, runCommand, schema as s } from '@pos/db';
import { asc, eq } from 'drizzle-orm';
import type { z } from 'zod';
import { type Actor, assertPermission } from '../../actor';
import { ApiError, notFound } from '../../errors';
import { definedOnly, type ServiceDeps } from '../shared';
import {
  assertCatalogRead,
  desiredTexts,
  loadTranslations,
  replaceTranslations,
  type TranslationMap,
} from './common';

// ── Categories (RF-B02, RF-B07, RF-B10) ─────────────────────────────────────

type CategoryRow = typeof s.categories.$inferSelect;

const toCategoryDto = (row: CategoryRow, translations: TranslationMap = {}) => ({
  id: row.id,
  parentId: row.parentId,
  name: row.name,
  description: row.description,
  imageUrl: row.imageUrl,
  sortOrder: row.sortOrder,
  isActive: row.isActive,
  translations,
});
export type CategoryDto = ReturnType<typeof toCategoryDto>;

async function loadCategory(db: Database, actor: Actor, id: string) {
  const [row] = await db
    .select()
    .from(s.categories)
    .where(inOrg(s.categories, actor, eq(s.categories.id, id), notDeleted(s.categories)));
  if (!row) throw notFound('Category');
  return row;
}

async function categoryDto(db: Database, actor: Actor, id: string): Promise<CategoryDto> {
  const row = await loadCategory(db, actor, id);
  const translations = await loadTranslations(db, actor, ['category'], [id]);
  return toCategoryDto(row, translations.get(id));
}

/** The parent must exist in the organization and must not be the category or one of its children. */
async function assertParent(db: Database, actor: Actor, id: string | null, parentId: string) {
  const all = await db
    .select({ id: s.categories.id, parentId: s.categories.parentId })
    .from(s.categories)
    .where(inOrg(s.categories, actor, notDeleted(s.categories)));
  const parentOf = new Map(all.map((c) => [c.id, c.parentId]));
  if (!parentOf.has(parentId)) throw notFound('Category');
  for (let cursor: string | null = parentId, steps = 0; cursor && steps <= all.length; steps += 1) {
    if (cursor === id) {
      throw new ApiError('VALIDATION_FAILED', 'A category cannot be inside itself', { path: ['parentId'] });
    }
    cursor = parentOf.get(cursor) ?? null;
  }
}

export async function listCategories(deps: ServiceDeps, actor: Actor): Promise<CategoryDto[]> {
  assertCatalogRead(actor);
  const rows = await deps.db
    .select()
    .from(s.categories)
    .where(inOrg(s.categories, actor, notDeleted(s.categories)))
    .orderBy(asc(s.categories.sortOrder), asc(s.categories.name));
  const translations = await loadTranslations(deps.db, actor, ['category']);
  return rows.map((row) => toCategoryDto(row, translations.get(row.id)));
}

export async function createCategory(
  deps: ServiceDeps,
  actor: Actor,
  input: z.output<typeof createCategorySchema>,
): Promise<CategoryDto> {
  assertPermission(actor, 'catalog.manage');
  if (input.parentId) await assertParent(deps.db, actor, null, input.parentId);
  const id = newId();
  await deps.db.insert(s.categories).values(ownedByOrg(actor, { ...input, id }));
  return categoryDto(deps.db, actor, id);
}

export async function updateCategory(
  deps: ServiceDeps,
  actor: Actor,
  id: string,
  input: z.output<typeof updateCategorySchema>,
): Promise<CategoryDto> {
  assertPermission(actor, 'catalog.manage');
  const current = await loadCategory(deps.db, actor, id);
  const patch = definedOnly(input);
  if (patch.parentId) await assertParent(deps.db, actor, id, patch.parentId);
  if (Object.keys(patch).length > 0) {
    await runCommand(deps.db, actor, async (tx, recorder) => {
      await tx.update(s.categories).set(patch).where(inOrg(s.categories, actor, eq(s.categories.id, id)));
      // Deactivating a category hides all its products (RF-B17: availability history).
      if (patch.isActive !== undefined && patch.isActive !== current.isActive) {
        recorder.audit({
          action: 'catalog.availability_changed',
          entityType: 'category',
          entityId: id,
          locationId: null,
          before: { isActive: current.isActive },
          after: { isActive: patch.isActive },
        });
      }
    });
  }
  return categoryDto(deps.db, actor, id);
}

/** Soft delete (PA-06), only when no product or subcategory is left in it. */
export async function deleteCategory(deps: ServiceDeps, actor: Actor, id: string): Promise<void> {
  assertPermission(actor, 'catalog.manage');
  await loadCategory(deps.db, actor, id);
  const [product] = await deps.db
    .select({ id: s.products.id })
    .from(s.products)
    .where(inOrg(s.products, actor, eq(s.products.categoryId, id), notDeleted(s.products)))
    .limit(1);
  const [child] = await deps.db
    .select({ id: s.categories.id })
    .from(s.categories)
    .where(inOrg(s.categories, actor, eq(s.categories.parentId, id), notDeleted(s.categories)))
    .limit(1);
  if (product || child) {
    throw new ApiError(
      'CONFLICT',
      'The category still has products or subcategories; move them first, or deactivate the category',
    );
  }
  await deps.db
    .update(s.categories)
    .set({ deletedAt: new Date(), isActive: false })
    .where(inOrg(s.categories, actor, eq(s.categories.id, id)));
}

export async function replaceCategoryTranslations(
  deps: ServiceDeps,
  actor: Actor,
  id: string,
  input: TextTranslationsInput,
): Promise<CategoryDto> {
  assertPermission(actor, 'catalog.manage');
  await loadCategory(deps.db, actor, id);
  await runCommand(deps.db, actor, (tx) =>
    replaceTranslations(tx, actor, 'category', id, desiredTexts(input, ['name', 'description'])),
  );
  return categoryDto(deps.db, actor, id);
}
