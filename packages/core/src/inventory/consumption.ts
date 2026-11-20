import type { OrderItemState } from '../orders/state';
import { type RecipeBook, resolveRecipe } from './recipes';

/**
 * What a sold item takes out of stock (DEC-051). Derived again from the order's fold on every
 * sync, so a late operation (a void that arrives after the send) corrects the result instead
 * of adding to it:
 *
 * - `sale`: the item left `pending`, sent to the kitchen or served straight at the bar.
 * - `returned`: voided before anyone started on it; nothing was used.
 * - `waste`: voided once in preparation, or voided because of a kitchen error or its quality
 *   (stations with only a printer never report «preparing»).
 *
 * The recipe is frozen with the first rows of an item: changing a recipe later never rewrites
 * what was already sold.
 */
export const CONSUMPTION_KINDS = ['sale', 'waste', 'returned'] as const;
export type ConsumptionKind = (typeof CONSUMPTION_KINDS)[number];

/** Void reasons that mean the dish was made: what went into it is gone. */
export const WASTE_VOID_REASONS: readonly string[] = ['kitchen_error', 'quality'];

/** Sales and waste take stock; a returned item keeps its rows only for the record. */
export const takesStock = (kind: ConsumptionKind) => kind !== 'returned';

export type ConsumingItem = Pick<
  OrderItemState,
  | 'id'
  | 'productId'
  | 'variantId'
  | 'modifiers'
  | 'quantity'
  | 'prepStatus'
  | 'kitchen'
  | 'sentAt'
  | 'preparingAt'
  | 'readyAt'
  | 'servedAt'
  | 'voidReason'
>;

/** Null while the item is still pending (or was voided while pending): it took nothing. */
export function consumptionKind(item: ConsumingItem): ConsumptionKind | null {
  if (item.sentAt === null && item.servedAt === null) return null;
  if (item.prepStatus !== 'voided') return 'sale';
  const started =
    item.preparingAt !== null ||
    item.readyAt !== null ||
    item.servedAt !== null ||
    Object.values(item.kitchen).some((k) => k.preparingAt !== null || k.readyAt !== null);
  const madeAnyway = item.voidReason !== null && WASTE_VOID_REASONS.includes(item.voidReason);
  return started || madeAnyway ? 'waste' : 'returned';
}

export interface StockUsage {
  orderItemId: string;
  ingredientId: string;
  kind: ConsumptionKind;
  /** Base units per one unit of the item (the frozen recipe). */
  perUnit: number;
  /** perUnit × the item's quantity. */
  quantity: number;
}

/** `${orderItemId}:${ingredientId}` → perUnit of the rows already written. */
export type FrozenUsage = ReadonlyMap<string, number>;
export const usageKey = (orderItemId: string, ingredientId: string) =>
  `${orderItemId}:${ingredientId}`;

/** The rows the consumption projection must hold for these items. */
export function stockUsage(
  items: Iterable<ConsumingItem>,
  book: RecipeBook,
  frozen: FrozenUsage = new Map(),
): StockUsage[] {
  const frozenByItem = new Map<string, Map<string, number>>();
  for (const [key, perUnit] of frozen) {
    const [orderItemId, ingredientId] = key.split(':') as [string, string];
    const recipe = frozenByItem.get(orderItemId) ?? new Map<string, number>();
    recipe.set(ingredientId, perUnit);
    frozenByItem.set(orderItemId, recipe);
  }

  const rows: StockUsage[] = [];
  for (const item of items) {
    const frozenRecipe = frozenByItem.get(item.id);
    // An item that never left pending only needs rows if an earlier sync wrote some.
    const kind = consumptionKind(item) ?? (frozenRecipe ? 'returned' : null);
    if (kind === null) continue;
    for (const [ingredientId, perUnit] of frozenRecipe ?? resolveRecipe(item, book)) {
      if (perUnit <= 0) continue;
      rows.push({
        orderItemId: item.id,
        ingredientId,
        kind,
        perUnit,
        quantity: perUnit * item.quantity,
      });
    }
  }
  return rows;
}
