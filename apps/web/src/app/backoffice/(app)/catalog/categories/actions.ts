'use server';

import { catalog } from '@pos/api';
import { createCategorySchema, textTranslationsSchema, updateCategorySchema } from '@pos/core';
import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { conflictAsRule } from '@/components/backoffice/catalog/explain-errors';
import { runAction } from '@/server/action';
import { currentActor, deps } from '@/server/actor';

/** Categories (RF-B02, RF-B07, RF-B10); the product list and sheets show their names. */
const done = <T>(value: T) => {
  revalidatePath('/backoffice/catalog/categories');
  revalidatePath('/backoffice/catalog');
  return value;
};

export async function createCategory(input: unknown) {
  return runAction(async () =>
    done(
      await catalog.createCategory(deps(), await currentActor(), createCategorySchema.parse(input)),
    ),
  );
}

/** Also (de)activates: an inactive category hides all its products (audited, RF-B17). */
export async function updateCategory(id: string, input: unknown) {
  return runAction(async () =>
    done(
      await catalog.updateCategory(
        deps(),
        await currentActor(),
        id,
        updateCategorySchema.parse(input),
      ),
    ),
  );
}

/** Only an empty category can be removed (409 otherwise). */
export async function deleteCategory(id: string) {
  return runAction(async () => {
    const t = await getTranslations('categories');
    await conflictAsRule(catalog.deleteCategory(deps(), await currentActor(), id), t('notEmpty'));
    return done(null);
  });
}

export async function replaceCategoryTranslations(id: string, input: unknown) {
  return runAction(async () =>
    done(
      await catalog.replaceCategoryTranslations(
        deps(),
        await currentActor(),
        id,
        textTranslationsSchema.parse(input),
      ),
    ),
  );
}
