import { CONSUMPTION_KINDS, takesStock } from '@pos/core';
import { type Database, inLocation, notDeleted, schema as s, type Transaction } from '@pos/db';
import { inArray, sql } from 'drizzle-orm';
import type { Actor } from '../../actor';

const STOCK_KINDS = CONSUMPTION_KINDS.filter(takesStock);

/**
 * Stock on hand at the actor's location by raw material (DEC-051): Σ movements − Σ what sales
 * and kitchen waste took. A raw material without movements is at 0.
 */
export async function stockOnHand(
  db: Database | Transaction,
  actor: Pick<Actor, 'organizationId' | 'locationId'>,
  ingredientIds?: readonly string[],
): Promise<Map<string, number>> {
  if (ingredientIds && ingredientIds.length === 0) return new Map();
  const movementFilter = ingredientIds
    ? inArray(s.stockMovements.ingredientId, [...ingredientIds])
    : undefined;
  const consumptionFilter = ingredientIds
    ? inArray(s.stockConsumptions.ingredientId, [...ingredientIds])
    : undefined;
  const [moved, used] = await Promise.all([
    db
      .select({
        ingredientId: s.stockMovements.ingredientId,
        total: sql<string>`coalesce(sum(${s.stockMovements.quantity}), 0)`,
      })
      .from(s.stockMovements)
      .where(inLocation(s.stockMovements, actor, movementFilter))
      .groupBy(s.stockMovements.ingredientId),
    db
      .select({
        ingredientId: s.stockConsumptions.ingredientId,
        total: sql<string>`coalesce(sum(${s.stockConsumptions.quantity}), 0)`,
      })
      .from(s.stockConsumptions)
      .where(
        inLocation(
          s.stockConsumptions,
          actor,
          consumptionFilter,
          inArray(s.stockConsumptions.kind, STOCK_KINDS),
          notDeleted(s.stockConsumptions),
        ),
      )
      .groupBy(s.stockConsumptions.ingredientId),
  ]);
  const onHand = new Map<string, number>();
  for (const row of moved) onHand.set(row.ingredientId, Number(row.total));
  for (const row of used) {
    onHand.set(row.ingredientId, (onHand.get(row.ingredientId) ?? 0) - Number(row.total));
  }
  return onHand;
}
