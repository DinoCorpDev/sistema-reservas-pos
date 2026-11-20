'use server';

import { inventory } from '@pos/api';
import {
  createIngredientSchema,
  recipeOwnerSchema,
  recordMovementSchema,
  replaceRecipeSchema,
  updateIngredientSchema,
} from '@pos/core';
import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { conflictAsRule } from '@/components/backoffice/catalog/explain-errors';
import { runAction } from '@/server/action';
import { currentActor, deps } from '@/server/actor';

/** Inventory by recipe (DEC-051); the overview shows how many are running low. */
const done = <T>(value: T) => {
  revalidatePath('/backoffice/inventory', 'layout');
  revalidatePath('/backoffice');
  return value;
};

export async function createIngredient(input: unknown) {
  return runAction(async () =>
    done(
      await inventory.createIngredient(
        deps(),
        await currentActor(),
        createIngredientSchema.parse(input),
      ),
    ),
  );
}

export async function updateIngredient(id: string, input: unknown) {
  return runAction(async () =>
    done(
      await inventory.updateIngredient(
        deps(),
        await currentActor(),
        id,
        updateIngredientSchema.parse(input),
      ),
    ),
  );
}

/** A raw material still in a recipe stays (409 → explained). */
export async function deleteIngredient(id: string) {
  return runAction(async () => {
    const t = await getTranslations('inventory');
    await conflictAsRule(inventory.deleteIngredient(deps(), await currentActor(), id), t('inUse'));
    return done(null);
  });
}

export async function recordMovement(id: string, input: unknown) {
  return runAction(async () =>
    done(
      await inventory.recordMovement(
        deps(),
        await currentActor(),
        id,
        recordMovementSchema.parse(input),
      ),
    ),
  );
}

export async function replaceRecipe(ownerType: unknown, ownerId: string, input: unknown) {
  return runAction(async () =>
    done(
      await inventory.replaceRecipe(
        deps(),
        await currentActor(),
        recipeOwnerSchema.parse(ownerType),
        ownerId,
        replaceRecipeSchema.parse(input),
      ),
    ),
  );
}
