import { newId, type RecipeOwnerType, type replaceRecipeSchema } from '@pos/core';
import { type Database, inOrg, notDeleted, ownedByOrg, runCommand, schema as s } from '@pos/db';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';
import { type Actor, assertPermission } from '../../actor';
import { notFound } from '../../errors';
import type { ServiceDeps } from '../shared';

// ── Recipes (DEC-051) ───────────────────────────────────────────────────────

export interface RecipeLineDto {
  ingredientId: string;
  quantity: number;
}

export interface RecipeOwnerDto {
  id: string;
  name: string;
  isActive: boolean;
  lines: RecipeLineDto[];
}

export interface RecipesDto {
  products: (RecipeOwnerDto & { categoryName: string; variants: RecipeOwnerDto[] })[];
  modifiers: (RecipeOwnerDto & { groupName: string })[];
}

async function linesByOwner(db: Database, actor: Actor) {
  const rows = await db
    .select({
      ownerType: s.recipeLines.ownerType,
      ownerId: s.recipeLines.ownerId,
      ingredientId: s.recipeLines.ingredientId,
      quantity: s.recipeLines.quantity,
    })
    .from(s.recipeLines)
    .where(inOrg(s.recipeLines, actor, notDeleted(s.recipeLines)));
  const map = new Map<string, RecipeLineDto[]>();
  for (const row of rows) {
    const key = `${row.ownerType}:${row.ownerId}`;
    map.set(key, [
      ...(map.get(key) ?? []),
      { ingredientId: row.ingredientId, quantity: row.quantity },
    ]);
  }
  return (type: RecipeOwnerType, id: string) => map.get(`${type}:${id}`) ?? [];
}

/** Every product (with its variants) and modifier option, with what each one uses. */
export async function listRecipes(deps: ServiceDeps, actor: Actor): Promise<RecipesDto> {
  assertPermission(actor, 'inventory.manage');
  const [lines, products, variants, modifiers] = await Promise.all([
    linesByOwner(deps.db, actor),
    deps.db
      .select({
        id: s.products.id,
        name: s.products.name,
        isActive: s.products.isActive,
        categoryName: s.categories.name,
      })
      .from(s.products)
      .innerJoin(s.categories, eq(s.categories.id, s.products.categoryId))
      .where(inOrg(s.products, actor, notDeleted(s.products)))
      .orderBy(asc(s.categories.sortOrder), asc(s.products.sortOrder), asc(s.products.name)),
    deps.db
      .select({
        id: s.productVariants.id,
        productId: s.productVariants.productId,
        name: s.productVariants.name,
        isActive: s.productVariants.isActive,
      })
      .from(s.productVariants)
      .where(inOrg(s.productVariants, actor, notDeleted(s.productVariants)))
      .orderBy(asc(s.productVariants.sortOrder)),
    deps.db
      .select({
        id: s.modifiers.id,
        name: s.modifiers.name,
        isActive: s.modifiers.isActive,
        groupName: s.modifierGroups.name,
      })
      .from(s.modifiers)
      .innerJoin(s.modifierGroups, eq(s.modifierGroups.id, s.modifiers.modifierGroupId))
      .where(inOrg(s.modifiers, actor, notDeleted(s.modifiers), notDeleted(s.modifierGroups)))
      .orderBy(asc(s.modifierGroups.sortOrder), asc(s.modifiers.sortOrder)),
  ]);
  return {
    products: products.map((p) => ({
      ...p,
      lines: lines('product', p.id),
      variants: variants
        .filter((v) => v.productId === p.id)
        .map((v) => ({
          id: v.id,
          name: v.name,
          isActive: v.isActive,
          lines: lines('variant', v.id),
        })),
    })),
    modifiers: modifiers.map((m) => ({ ...m, lines: lines('modifier', m.id) })),
  };
}

async function assertOwner(db: Database, actor: Actor, type: RecipeOwnerType, id: string) {
  const table =
    type === 'product' ? s.products : type === 'variant' ? s.productVariants : s.modifiers;
  const [row] = await db
    .select({ id: table.id })
    .from(table)
    .where(inOrg(table, actor, eq(table.id, id), notDeleted(table)));
  if (!row) throw notFound(type === 'modifier' ? 'Modifier' : 'Product');
}

/**
 * Replaces what one product, variant or modifier option uses. Sales already synced keep the
 * recipe they were sold with (DEC-051); this only applies from now on.
 */
export async function replaceRecipe(
  deps: ServiceDeps,
  actor: Actor,
  ownerType: RecipeOwnerType,
  ownerId: string,
  input: z.output<typeof replaceRecipeSchema>,
): Promise<RecipeLineDto[]> {
  assertPermission(actor, 'inventory.manage');
  await assertOwner(deps.db, actor, ownerType, ownerId);
  const wanted = new Map(input.lines.map((l) => [l.ingredientId, l.quantity]));
  if (wanted.size > 0) {
    const known = await deps.db
      .select({ id: s.ingredients.id })
      .from(s.ingredients)
      .where(
        inOrg(
          s.ingredients,
          actor,
          inArray(s.ingredients.id, [...wanted.keys()]),
          notDeleted(s.ingredients),
        ),
      );
    if (known.length !== wanted.size) throw notFound('Ingredient');
  }

  const ofOwner = and(eq(s.recipeLines.ownerType, ownerType), eq(s.recipeLines.ownerId, ownerId));
  const existing = await deps.db
    .select()
    .from(s.recipeLines)
    .where(inOrg(s.recipeLines, actor, ofOwner));
  const before = existing
    .filter((row) => row.deletedAt === null)
    .map((row) => ({ ingredientId: row.ingredientId, quantity: row.quantity }));

  await runCommand(deps.db, actor, async (tx, recorder) => {
    const now = new Date();
    for (const row of existing) {
      const quantity = wanted.get(row.ingredientId);
      if (quantity === undefined) {
        if (row.deletedAt === null) {
          await tx
            .update(s.recipeLines)
            .set({ deletedAt: now })
            .where(inOrg(s.recipeLines, actor, eq(s.recipeLines.id, row.id)));
        }
      } else if (row.quantity !== quantity || row.deletedAt !== null) {
        await tx
          .update(s.recipeLines)
          .set({ quantity, deletedAt: null })
          .where(inOrg(s.recipeLines, actor, eq(s.recipeLines.id, row.id)));
      }
    }
    const stored = new Set(existing.map((row) => row.ingredientId));
    const fresh = input.lines.filter((l) => !stored.has(l.ingredientId));
    if (fresh.length > 0) {
      await tx
        .insert(s.recipeLines)
        .values(fresh.map((l) => ownedByOrg(actor, { id: newId(), ownerType, ownerId, ...l })));
    }
    recorder.audit({
      action: 'inventory.recipe_changed',
      entityType: ownerType,
      entityId: ownerId,
      locationId: null,
      before: { lines: before },
      after: { lines: input.lines },
    });
    recorder.event({
      type: 'inventory.recipe_changed',
      aggregateType: ownerType,
      aggregateId: ownerId,
      locationId: null,
      payload: { ownerType, ownerId, lines: input.lines },
    });
  });
  return input.lines;
}
