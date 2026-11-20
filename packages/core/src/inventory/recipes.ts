/**
 * Recipes (DEC-051): how much of each raw material one unit of a product, a variant or a
 * modifier option uses. A variant with its own recipe replaces the product's (a large portion
 * is not «product plus extra»); modifier options add theirs on top, times how many were chosen.
 */
export const RECIPE_OWNER_TYPES = ['product', 'variant', 'modifier'] as const;
export type RecipeOwnerType = (typeof RECIPE_OWNER_TYPES)[number];

export interface RecipeLine {
  ownerType: RecipeOwnerType;
  ownerId: string;
  ingredientId: string;
  /** Base units (g, ml, pieces) per one unit of the owner. */
  quantity: number;
}

interface RecipeAmount {
  ingredientId: string;
  quantity: number;
}

/** Recipes by owner, ready to resolve sold items. */
export type RecipeBook = ReadonlyMap<string, readonly RecipeAmount[]>;

const keyOf = (ownerType: RecipeOwnerType, ownerId: string) => `${ownerType}:${ownerId}`;

export function recipeBook(lines: readonly RecipeLine[]): RecipeBook {
  const book = new Map<string, RecipeAmount[]>();
  for (const line of lines) {
    const key = keyOf(line.ownerType, line.ownerId);
    const list = book.get(key) ?? [];
    list.push({ ingredientId: line.ingredientId, quantity: line.quantity });
    book.set(key, list);
  }
  return book;
}

export interface RecipeItem {
  productId: string;
  variantId: string | null;
  modifiers: ReadonlyArray<{ modifierId: string; quantity: number }>;
}

/** Raw material for ONE unit of a sold item: ingredientId → base units. Empty without recipe. */
export function resolveRecipe(item: RecipeItem, book: RecipeBook): Map<string, number> {
  const usage = new Map<string, number>();
  const add = (lines: readonly RecipeAmount[], times = 1) => {
    for (const line of lines) {
      usage.set(line.ingredientId, (usage.get(line.ingredientId) ?? 0) + line.quantity * times);
    }
  };
  const variant = item.variantId ? book.get(keyOf('variant', item.variantId)) : undefined;
  add(variant && variant.length > 0 ? variant : (book.get(keyOf('product', item.productId)) ?? []));
  for (const modifier of item.modifiers) {
    add(book.get(keyOf('modifier', modifier.modifierId)) ?? [], modifier.quantity);
  }
  return usage;
}
