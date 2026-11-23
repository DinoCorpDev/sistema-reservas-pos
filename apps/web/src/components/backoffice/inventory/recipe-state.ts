import type { inventory } from '@pos/api';

type Ingredient = Pick<inventory.IngredientDto, 'id' | 'onHand'>;
type Line = inventory.RecipeLineDto;

/** How many portions the stock allows: the scarcest ingredient decides; null if unknown. */
export function portionsLeft(lines: Line[], byId: Map<string, Ingredient>): number | null {
  let least: number | null = null;
  for (const line of lines) {
    const onHand = byId.get(line.ingredientId)?.onHand;
    if (onHand === null || onHand === undefined || line.quantity <= 0) return null;
    const portions = Math.floor(Math.max(0, onHand) / line.quantity);
    least = least === null ? portions : Math.min(least, portions);
  }
  return least;
}

/** Where a dish of the menu stands with its recipe (DEC-051, DEC-053). */
export type RecipeState = 'with' | 'without' | 'noStock';

/**
 * The recipe state of every dish: without lines on the dish or any variant it has none; with
 * them, the dish is out of stock when its own recipe no longer reaches one portion.
 */
export function recipeStates(
  recipes: inventory.RecipesDto,
  ingredients: Ingredient[],
): Record<string, RecipeState> {
  const byId = new Map(ingredients.map((i) => [i.id, i]));
  const states: Record<string, RecipeState> = {};
  for (const product of recipes.products) {
    const hasRecipe =
      product.lines.length > 0 || product.variants.some((variant) => variant.lines.length > 0);
    if (!hasRecipe) {
      states[product.id] = 'without';
      continue;
    }
    const portions = product.lines.length > 0 ? portionsLeft(product.lines, byId) : null;
    states[product.id] = portions === 0 ? 'noStock' : 'with';
  }
  return states;
}
