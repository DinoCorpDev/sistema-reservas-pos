import { movementDelta, type MovementKind, newId, type recordMovementSchema } from '@pos/core';
import { inLocation, notDeleted, ownedByLocation, runCommand, schema as s } from '@pos/db';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { type Actor, assertPermission, requireLocationId, requireUserId } from '../../actor';
import { iso, type ServiceDeps } from '../shared';
import { type IngredientDto, ingredientDto, loadIngredient } from './ingredients';
import { stockOnHand } from './stock';

/**
 * A purchase, waste, adjustment or count entered by hand (DEC-051). Never edited: a mistake is
 * corrected with another movement. The count is computed against the stock right now, inside
 * the same transaction.
 */
export async function recordMovement(
  deps: ServiceDeps,
  actor: Actor,
  ingredientId: string,
  input: z.output<typeof recordMovementSchema>,
): Promise<IngredientDto> {
  assertPermission(actor, 'inventory.manage');
  const locationId = requireLocationId(actor);
  const userId = requireUserId(actor);
  await loadIngredient(deps.db, actor, ingredientId);
  const id = newId();
  await runCommand(deps.db, actor, async (tx, recorder) => {
    const onHand = (await stockOnHand(tx, actor, [ingredientId])).get(ingredientId) ?? 0;
    const quantity = movementDelta(input.kind, input.quantity, onHand);
    const now = new Date();
    await tx.insert(s.stockMovements).values(
      ownedByLocation(actor, {
        id,
        ingredientId,
        kind: input.kind,
        quantity,
        countedQuantity: input.kind === 'count' ? input.quantity : null,
        note: input.note,
        userId,
        occurredAt: now,
        createdAt: now,
      }),
    );
    recorder.audit({
      action: 'inventory.movement_recorded',
      entityType: 'ingredient',
      entityId: ingredientId,
      before: { onHand },
      after: { onHand: onHand + quantity, kind: input.kind, quantity },
      reason: input.note,
    });
    recorder.event({
      type: 'inventory.movement_recorded',
      aggregateType: 'ingredient',
      aggregateId: ingredientId,
      locationId,
      payload: { movementId: id, ingredientId, kind: input.kind, quantity },
    });
  });
  return ingredientDto(deps.db, actor, ingredientId);
}

export interface MovementDto {
  id: string;
  kind: MovementKind;
  quantity: number;
  countedQuantity: number | null;
  note: string | null;
  userName: string | null;
  occurredAt: string;
}

export interface ConsumptionDayDto {
  businessDate: string;
  sold: number;
  wasted: number;
}

/** The last movements by hand and what sales and kitchen waste took per day. */
export async function ingredientHistory(
  deps: ServiceDeps,
  actor: Actor,
  ingredientId: string,
): Promise<{ ingredient: IngredientDto; movements: MovementDto[]; days: ConsumptionDayDto[] }> {
  assertPermission(actor, 'inventory.manage');
  requireLocationId(actor);
  const ingredient = await ingredientDto(deps.db, actor, ingredientId);
  const [movements, days] = await Promise.all([
    deps.db
      .select({
        id: s.stockMovements.id,
        kind: s.stockMovements.kind,
        quantity: s.stockMovements.quantity,
        countedQuantity: s.stockMovements.countedQuantity,
        note: s.stockMovements.note,
        userName: s.users.displayName,
        occurredAt: s.stockMovements.occurredAt,
      })
      .from(s.stockMovements)
      .leftJoin(s.users, eq(s.users.id, s.stockMovements.userId))
      .where(inLocation(s.stockMovements, actor, eq(s.stockMovements.ingredientId, ingredientId)))
      .orderBy(desc(s.stockMovements.occurredAt))
      .limit(100),
    deps.db
      .select({
        businessDate: s.stockConsumptions.businessDate,
        sold: sql<string>`coalesce(sum(case when ${s.stockConsumptions.kind} = 'sale' then ${s.stockConsumptions.quantity} else 0 end), 0)`,
        wasted: sql<string>`coalesce(sum(case when ${s.stockConsumptions.kind} = 'waste' then ${s.stockConsumptions.quantity} else 0 end), 0)`,
      })
      .from(s.stockConsumptions)
      .where(
        inLocation(
          s.stockConsumptions,
          actor,
          and(
            eq(s.stockConsumptions.ingredientId, ingredientId),
            inArray(s.stockConsumptions.kind, ['sale', 'waste']),
          ),
          notDeleted(s.stockConsumptions),
        ),
      )
      .groupBy(s.stockConsumptions.businessDate)
      .orderBy(desc(s.stockConsumptions.businessDate))
      .limit(30),
  ]);
  return {
    ingredient,
    movements: movements.map((m) => ({
      ...m,
      kind: m.kind as MovementKind,
      occurredAt: iso(m.occurredAt)!,
    })),
    days: days
      .filter((d) => d.businessDate !== null)
      .map((d) => ({
        businessDate: d.businessDate!,
        sold: Number(d.sold),
        wasted: Number(d.wasted),
      })),
  };
}
