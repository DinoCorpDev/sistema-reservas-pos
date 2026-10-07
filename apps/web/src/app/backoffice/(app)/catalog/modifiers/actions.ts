'use server';

import { catalog } from '@pos/api';
import {
  createModifierGroupSchema,
  nameTranslationsSchema,
  replaceModifiersSchema,
  updateModifierGroupSchema,
} from '@pos/core';
import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { conflictAsRule } from '@/components/backoffice/catalog/explain-errors';
import { runAction } from '@/server/action';
import { currentActor, deps } from '@/server/actor';

/** Modifier groups and their modifiers (RF-B02, RF-B05, RF-B07); product sheets list them too. */
const done = <T>(groupId: string | null, value: T) => {
  revalidatePath('/backoffice/catalog/modifiers');
  if (groupId) revalidatePath(`/backoffice/catalog/modifiers/${groupId}`);
  revalidatePath('/backoffice/catalog/products/[id]', 'page');
  return value;
};

export async function createModifierGroup(input: unknown) {
  return runAction(async () => {
    const group = await catalog.createModifierGroup(
      deps(),
      await currentActor(),
      createModifierGroupSchema.parse(input),
    );
    return done(group.id, group);
  });
}

export async function updateModifierGroup(id: string, input: unknown) {
  return runAction(async () =>
    done(
      id,
      await catalog.updateModifierGroup(
        deps(),
        await currentActor(),
        id,
        updateModifierGroupSchema.parse(input),
      ),
    ),
  );
}

/** Only a group no product uses can be removed (409 otherwise). */
export async function deleteModifierGroup(id: string) {
  return runAction(async () => {
    const t = await getTranslations('modifiers');
    await conflictAsRule(catalog.deleteModifierGroup(deps(), await currentActor(), id), t('inUse'));
    return done(null, null);
  });
}

/** A changed surcharge is a price change: needs catalog.price_change (RF-B17). */
export async function replaceModifiers(id: string, input: unknown) {
  return runAction(async () =>
    done(
      id,
      await catalog.replaceModifiers(
        deps(),
        await currentActor(),
        id,
        replaceModifiersSchema.parse(input),
      ),
    ),
  );
}

export async function replaceModifierGroupTranslations(id: string, input: unknown) {
  return runAction(async () =>
    done(
      id,
      await catalog.replaceModifierGroupTranslations(
        deps(),
        await currentActor(),
        id,
        nameTranslationsSchema.parse(input),
      ),
    ),
  );
}
