'use server';

import { catalog } from '@pos/api';
import {
  createProductSchema,
  markSoldOutSchema,
  productLocationSettingsSchema,
  replaceAllergensSchema,
  replaceAvailabilitySchema,
  replaceChannelPricesSchema,
  replaceOriginsSchema,
  replaceProductModifierGroupsSchema,
  replaceProductStationsSchema,
  replaceVariantsSchema,
  textTranslationsSchema,
  updateProductSchema,
} from '@pos/core';
import { revalidatePath } from 'next/cache';
import { explainPublication } from '@/components/backoffice/catalog/explain-errors';
import { runAction } from '@/server/action';
import { currentActor, deps } from '@/server/actor';

/**
 * Product use cases for the backoffice (RF-B01…RF-B18). Each one runs with the signed-in actor,
 * so the permissions (catalog.manage, catalog.price_change, catalog.sold_out) are checked on the
 * server again. The overview's setup checklist counts products, routing, publication and
 * translations (RF-A11), so it is revalidated too.
 */
const done = <T>(productId: string | null, value: T) => {
  revalidatePath('/backoffice/catalog');
  if (productId) revalidatePath(`/backoffice/catalog/products/${productId}`);
  revalidatePath('/backoffice');
  return value;
};

export async function createProduct(input: unknown) {
  return runAction(async () => {
    const product = await explainPublication(
      catalog.createProduct(deps(), await currentActor(), createProductSchema.parse(input)),
    );
    return done(product.id, product);
  });
}

export async function updateProduct(id: string, input: unknown) {
  return runAction(async () =>
    done(
      id,
      await explainPublication(
        catalog.updateProduct(deps(), await currentActor(), id, updateProductSchema.parse(input)),
      ),
    ),
  );
}

export async function deleteProduct(id: string) {
  return runAction(async () => {
    await catalog.deleteProduct(deps(), await currentActor(), id);
    return done(id, null);
  });
}

/** RF-B18: the copy starts inactive; the editor opens it. */
export async function duplicateProduct(id: string) {
  return runAction(async () => {
    const copy = await catalog.duplicateProduct(deps(), await currentActor(), id);
    return done(copy.id, copy);
  });
}

// ── "86" at the current location (RF-B09) ───────────────────────────────────

export async function markSoldOut(id: string, input: unknown) {
  return runAction(async () =>
    done(
      id,
      await catalog.markSoldOut(deps(), await currentActor(), id, markSoldOutSchema.parse(input)),
    ),
  );
}

export async function restoreSoldOut(id: string) {
  return runAction(async () =>
    done(id, await catalog.restoreSoldOut(deps(), await currentActor(), id)),
  );
}

// ── Collections of the product, each replaced as a whole ────────────────────

export async function replaceVariants(id: string, input: unknown) {
  return runAction(async () =>
    done(
      id,
      await catalog.replaceVariants(
        deps(),
        await currentActor(),
        id,
        replaceVariantsSchema.parse(input),
      ),
    ),
  );
}

export async function replaceChannelPrices(id: string, input: unknown) {
  return runAction(async () =>
    done(
      id,
      await catalog.replaceChannelPrices(
        deps(),
        await currentActor(),
        id,
        replaceChannelPricesSchema.parse(input),
      ),
    ),
  );
}

export async function updateLocationSettings(id: string, input: unknown) {
  return runAction(async () =>
    done(
      id,
      await catalog.updateProductLocationSettings(
        deps(),
        await currentActor(),
        id,
        productLocationSettingsSchema.parse(input),
      ),
    ),
  );
}

export async function replaceModifierGroups(id: string, input: unknown) {
  return runAction(async () =>
    done(
      id,
      await catalog.replaceProductModifierGroups(
        deps(),
        await currentActor(),
        id,
        replaceProductModifierGroupsSchema.parse(input),
      ),
    ),
  );
}

export async function replaceAllergens(id: string, input: unknown) {
  return runAction(async () =>
    done(
      id,
      await catalog.replaceAllergens(
        deps(),
        await currentActor(),
        id,
        replaceAllergensSchema.parse(input),
      ),
    ),
  );
}

export async function replaceOrigins(id: string, input: unknown) {
  return runAction(async () =>
    done(
      id,
      await catalog.replaceOrigins(deps(), await currentActor(), id, replaceOriginsSchema.parse(input)),
    ),
  );
}

export async function replaceTranslations(id: string, input: unknown) {
  return runAction(async () =>
    done(
      id,
      await catalog.replaceProductTranslations(
        deps(),
        await currentActor(),
        id,
        textTranslationsSchema.parse(input),
      ),
    ),
  );
}

export async function replaceAvailability(id: string, input: unknown) {
  return runAction(async () =>
    done(
      id,
      await catalog.replaceAvailability(
        deps(),
        await currentActor(),
        id,
        replaceAvailabilitySchema.parse(input),
      ),
    ),
  );
}

export async function replaceStations(id: string, input: unknown) {
  return runAction(async () =>
    done(
      id,
      await catalog.replaceProductStations(
        deps(),
        await currentActor(),
        id,
        replaceProductStationsSchema.parse(input),
      ),
    ),
  );
}
