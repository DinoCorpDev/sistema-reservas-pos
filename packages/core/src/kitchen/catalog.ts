import { ALLERGENS } from '../catalog/constants';
import { type CatalogSnapshot, snapshotText } from '../catalog/menu';
import type { ContentLanguage } from '../shared/languages';

/**
 * What the kitchen needs from the catalog, in the kitchen language (RF-C25): product, variant and
 * modifier names, and the allergens marked on the ticket (RF-C20). The KDS and the hub build it
 * from the same snapshot the POS uses; names fall back to the line's frozen name.
 */

export interface KitchenAllergen {
  allergen: string;
  presence: string;
}

export interface KitchenCatalog {
  language: ContentLanguage;
  productName(productId: string, fallback: string): string;
  variantName(variantId: string | null, fallback: string | null): string | null;
  modifierName(modifierId: string, fallback: string): string;
  /** Allergens of the product and its chosen modifiers, in the legal order, "contains" first. */
  allergens(productId: string, modifierIds: readonly string[]): KitchenAllergen[];
}

const order = (allergen: string) => (ALLERGENS as readonly string[]).indexOf(allergen);

export function kitchenCatalog(
  snapshot: Pick<
    CatalogSnapshot,
    | 'translations'
    | 'locationLanguage'
    | 'catalogLanguage'
    | 'products'
    | 'variants'
    | 'modifiers'
    | 'allergens'
    | 'modifierAllergens'
  >,
  language: ContentLanguage,
): KitchenCatalog {
  const products = new Map(snapshot.products.map((p) => [p.id, p]));
  const variants = new Map(snapshot.variants.map((v) => [v.id, v]));
  const modifiers = new Map(snapshot.modifiers.map((m) => [m.id, m]));
  const productAllergens = new Map<string, KitchenAllergen[]>();
  for (const row of snapshot.allergens) {
    const list = productAllergens.get(row.productId) ?? [];
    list.push({ allergen: row.allergen, presence: row.presence });
    productAllergens.set(row.productId, list);
  }
  const modifierAllergens = new Map<string, KitchenAllergen[]>();
  for (const row of snapshot.modifierAllergens) {
    const list = modifierAllergens.get(row.modifierId) ?? [];
    list.push({ allergen: row.allergen, presence: row.presence });
    modifierAllergens.set(row.modifierId, list);
  }
  const text = (id: string, catalogText: string | null, fallback: string) =>
    snapshotText(snapshot, id, 'name', catalogText, language) ?? fallback;

  return {
    language,
    productName: (productId, fallback) =>
      text(productId, products.get(productId)?.name ?? null, fallback),
    variantName: (variantId, fallback) =>
      variantId === null
        ? fallback
        : text(variantId, variants.get(variantId)?.name ?? null, fallback ?? ''),
    modifierName: (modifierId, fallback) =>
      text(modifierId, modifiers.get(modifierId)?.name ?? null, fallback),
    allergens(productId, modifierIds) {
      // "Contains" wins over "may contain" when a product and a modifier disagree.
      const merged = new Map<string, string>();
      const rows = [
        ...(productAllergens.get(productId) ?? []),
        ...modifierIds.flatMap((id) => modifierAllergens.get(id) ?? []),
      ];
      for (const row of rows) {
        if (merged.get(row.allergen) !== 'contains') merged.set(row.allergen, row.presence);
      }
      return [...merged.entries()]
        .map(([allergen, presence]) => ({ allergen, presence }))
        .sort((a, b) => order(a.allergen) - order(b.allergen));
    },
  };
}

/** Without a catalog (it never loaded): the names frozen in the lines, no allergens. */
export function frozenNamesCatalog(language: ContentLanguage): KitchenCatalog {
  return {
    language,
    productName: (_id, fallback) => fallback,
    variantName: (_id, fallback) => fallback,
    modifierName: (_id, fallback) => fallback,
    allergens: () => [],
  };
}
