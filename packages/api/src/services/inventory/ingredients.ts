import {
  type createIngredientSchema,
  isLowStock,
  newId,
  type StockUnit,
  type updateIngredientSchema,
} from '@pos/core';
import { type Database, inOrg, notDeleted, ownedByOrg, runCommand, schema as s } from '@pos/db';
import { asc, eq } from 'drizzle-orm';
import type { z } from 'zod';
import { type Actor, assertPermission } from '../../actor';
import { ApiError, notFound } from '../../errors';
import { changedFields, definedOnly, type ServiceDeps } from '../shared';
import { stockOnHand } from './stock';

// ── Raw materials (DEC-051) ─────────────────────────────────────────────────

type IngredientRow = typeof s.ingredients.$inferSelect;

const toIngredientDto = (row: IngredientRow, onHand: number | null) => ({
  id: row.id,
  name: row.name,
  unit: row.unit as StockUnit,
  lowStockThreshold: row.lowStockThreshold,
  isActive: row.isActive,
  /** Stock at the actor's location; null without a location. */
  onHand,
  isLow: onHand !== null && row.isActive && isLowStock(onHand, row.lowStockThreshold),
});
export type IngredientDto = ReturnType<typeof toIngredientDto>;

export async function loadIngredient(db: Database, actor: Actor, id: string) {
  const [row] = await db
    .select()
    .from(s.ingredients)
    .where(inOrg(s.ingredients, actor, eq(s.ingredients.id, id), notDeleted(s.ingredients)));
  if (!row) throw notFound('Ingredient');
  return row;
}

export async function ingredientDto(
  db: Database,
  actor: Actor,
  id: string,
): Promise<IngredientDto> {
  const row = await loadIngredient(db, actor, id);
  const onHand = actor.locationId ? ((await stockOnHand(db, actor, [id])).get(id) ?? 0) : null;
  return toIngredientDto(row, onHand);
}

/** Every raw material with its stock; the low ones first, then by name. */
export async function listIngredients(deps: ServiceDeps, actor: Actor): Promise<IngredientDto[]> {
  assertPermission(actor, 'inventory.manage');
  const rows = await deps.db
    .select()
    .from(s.ingredients)
    .where(inOrg(s.ingredients, actor, notDeleted(s.ingredients)))
    .orderBy(asc(s.ingredients.name));
  const stock = actor.locationId ? await stockOnHand(deps.db, actor) : null;
  const list = rows.map((row) => toIngredientDto(row, stock ? (stock.get(row.id) ?? 0) : null));
  return [...list.filter((i) => i.isLow), ...list.filter((i) => !i.isLow)];
}

/** How many active raw materials are at or under their level (the dashboard card). */
export async function countLowStock(deps: ServiceDeps, actor: Actor): Promise<number> {
  assertPermission(actor, 'inventory.manage');
  if (!actor.locationId) return 0;
  return (await listIngredients(deps, actor)).filter((i) => i.isLow).length;
}

export async function createIngredient(
  deps: ServiceDeps,
  actor: Actor,
  input: z.output<typeof createIngredientSchema>,
): Promise<IngredientDto> {
  assertPermission(actor, 'inventory.manage');
  const id = newId();
  await runCommand(deps.db, actor, async (tx, recorder) => {
    await tx.insert(s.ingredients).values(ownedByOrg(actor, { ...input, id }));
    recorder.audit({
      action: 'inventory.ingredient_created',
      entityType: 'ingredient',
      entityId: id,
      locationId: null,
      after: input,
    });
  });
  return ingredientDto(deps.db, actor, id);
}

export async function updateIngredient(
  deps: ServiceDeps,
  actor: Actor,
  id: string,
  input: z.output<typeof updateIngredientSchema>,
): Promise<IngredientDto> {
  assertPermission(actor, 'inventory.manage');
  const current = await loadIngredient(deps.db, actor, id);
  const patch = definedOnly(input);
  const { before, after } = changedFields(current, patch);
  if (Object.keys(after).length > 0) {
    await runCommand(deps.db, actor, async (tx, recorder) => {
      await tx
        .update(s.ingredients)
        .set(patch)
        .where(inOrg(s.ingredients, actor, eq(s.ingredients.id, id)));
      recorder.audit({
        action: 'inventory.ingredient_updated',
        entityType: 'ingredient',
        entityId: id,
        locationId: null,
        before,
        after,
      });
    });
  }
  return ingredientDto(deps.db, actor, id);
}

/** Soft delete; a raw material still used by a recipe stays (deactivate it instead). */
export async function deleteIngredient(deps: ServiceDeps, actor: Actor, id: string): Promise<void> {
  assertPermission(actor, 'inventory.manage');
  await loadIngredient(deps.db, actor, id);
  const [used] = await deps.db
    .select({ id: s.recipeLines.id })
    .from(s.recipeLines)
    .where(
      inOrg(s.recipeLines, actor, eq(s.recipeLines.ingredientId, id), notDeleted(s.recipeLines)),
    )
    .limit(1);
  if (used) throw new ApiError('CONFLICT', 'The ingredient is used in a recipe');
  await runCommand(deps.db, actor, async (tx, recorder) => {
    await tx
      .update(s.ingredients)
      .set({ deletedAt: new Date(), isActive: false })
      .where(inOrg(s.ingredients, actor, eq(s.ingredients.id, id)));
    recorder.audit({
      action: 'inventory.ingredient_deleted',
      entityType: 'ingredient',
      entityId: id,
      locationId: null,
    });
  });
}
