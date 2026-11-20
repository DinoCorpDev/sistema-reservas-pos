import {
  consumptionKind,
  type FoldState,
  type FrozenUsage,
  newId,
  type OrderItemState,
  type RecipeOwnerType,
  recipeBook,
  stockUsage,
  usageKey,
} from '@pos/core';
import { notDeleted, schema as s, type Transaction } from '@pos/db';
import { and, eq, getTableColumns, inArray, sql, type SQL } from 'drizzle-orm';
import type { SyncScope } from '../sync/store';

const CHUNK = 200;
const NEVER_UPDATED = new Set(['id', 'organizationId', 'locationId', 'createdAt', 'perUnit']);

const at = (iso: string | null): Date | null => (iso === null ? null : new Date(iso));

/**
 * What the items of a group of orders took from stock (DEC-051), written next to the order
 * projection in the same transaction. Rows are upserted by (item, raw material) from the full
 * fold, so writing the same fold twice changes nothing and a late operation corrects the rows.
 * The per-unit amount is never updated: the recipe stays the one the item was first sold with.
 */
export async function projectStock(
  tx: Transaction,
  scope: SyncScope,
  state: FoldState,
  orderIds: ReadonlySet<string>,
): Promise<void> {
  const items = [...state.items.values()].filter((i) => orderIds.has(i.orderId));
  if (items.length === 0) return;

  const written = await tx
    .select({
      orderItemId: s.stockConsumptions.orderItemId,
      ingredientId: s.stockConsumptions.ingredientId,
      perUnit: s.stockConsumptions.perUnit,
    })
    .from(s.stockConsumptions)
    .where(
      and(
        eq(s.stockConsumptions.locationId, scope.locationId),
        inArray(
          s.stockConsumptions.orderItemId,
          items.map((i) => i.id),
        ),
      ),
    );
  const frozen: FrozenUsage = new Map(
    written.map((row) => [usageKey(row.orderItemId, row.ingredientId), row.perUnit]),
  );
  const withRows = new Set(written.map((row) => row.orderItemId));
  const needRecipe = items.filter((i) => !withRows.has(i.id) && consumptionKind(i) !== null);
  if (needRecipe.length === 0 && written.length === 0) return;

  const book = recipeBook(needRecipe.length > 0 ? await recipesFor(tx, scope, needRecipe) : []);
  const rows = stockUsage(items, book, frozen);
  if (rows.length === 0) return;

  const now = new Date();
  const set: Record<string, SQL> = {};
  for (const [key, column] of Object.entries(getTableColumns(s.stockConsumptions))) {
    if (NEVER_UPDATED.has(key)) continue;
    set[key] = sql.raw(`values(\`${column.name}\`)`);
  }
  const values = rows.map((row) => {
    const item = state.items.get(row.orderItemId)!;
    return {
      id: newId(),
      organizationId: scope.organizationId,
      locationId: scope.locationId,
      orderId: item.orderId,
      orderItemId: row.orderItemId,
      ingredientId: row.ingredientId,
      kind: row.kind,
      perUnit: row.perUnit,
      quantity: row.quantity,
      businessDate: state.orders.get(item.orderId)?.businessDate ?? null,
      occurredAt: at(item.voidedAt ?? item.sentAt ?? item.servedAt),
      deviceUpdatedAt: at(item.voidedAt ?? item.servedAt ?? item.sentAt),
      updatedAt: now,
    };
  });
  for (let start = 0; start < values.length; start += CHUNK) {
    await tx
      .insert(s.stockConsumptions)
      .values(values.slice(start, start + CHUNK))
      .onDuplicateKeyUpdate({ set: set as never });
  }
}

/** The recipe lines of the products, variants and modifier options of these items. */
async function recipesFor(tx: Transaction, scope: SyncScope, items: readonly OrderItemState[]) {
  const owners: Record<RecipeOwnerType, Set<string>> = {
    product: new Set(),
    variant: new Set(),
    modifier: new Set(),
  };
  for (const item of items) {
    owners.product.add(item.productId);
    if (item.variantId) owners.variant.add(item.variantId);
    for (const m of item.modifiers) owners.modifier.add(m.modifierId);
  }
  const ids = [...owners.product, ...owners.variant, ...owners.modifier];
  const rows = await tx
    .select({
      ownerType: s.recipeLines.ownerType,
      ownerId: s.recipeLines.ownerId,
      ingredientId: s.recipeLines.ingredientId,
      quantity: s.recipeLines.quantity,
    })
    .from(s.recipeLines)
    .where(
      and(
        eq(s.recipeLines.organizationId, scope.organizationId),
        inArray(s.recipeLines.ownerId, ids),
        notDeleted(s.recipeLines),
      ),
    );
  return rows.map((row) => ({ ...row, ownerType: row.ownerType as RecipeOwnerType }));
}
