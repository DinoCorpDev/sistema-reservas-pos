import {
  boolean,
  date,
  index,
  int,
  mysqlTable,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import {
  locationId,
  organizationId,
  primaryId,
  syncColumns,
  timestamps,
  utcDatetime,
  uuid,
} from '../columns';
import { organizations } from './organization';

/**
 * Inventory by recipe (DEC-051). Quantities are whole base units (g, ml, pieces), never
 * decimals. Stock = Σ stock_movements − Σ stock_consumptions that take stock.
 */

/** A raw material of the organization: beef, potatoes, oil… */
export const ingredients = mysqlTable('ingredients', {
  id: primaryId(),
  organizationId: organizationId().references(() => organizations.id),
  name: varchar('name', { length: 100 }).notNull(),
  /** `g`, `ml` or `unit` (STOCK_UNITS of @pos/core); fixed once created. */
  unit: varchar('unit', { length: 8 }).notNull(),
  /** Warn at or under this stock; null = never. */
  lowStockThreshold: int('low_stock_threshold'),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps(),
});

/**
 * How much of a raw material one unit of a product, a variant or a modifier option uses. The
 * owner is polymorphic (`owner_type` + `owner_id`), so only the ingredient has a FK.
 */
export const recipeLines = mysqlTable(
  'recipe_lines',
  {
    id: primaryId(),
    organizationId: organizationId().references(() => organizations.id),
    ownerType: varchar('owner_type', { length: 16 }).notNull(),
    ownerId: uuid('owner_id').notNull(),
    ingredientId: uuid('ingredient_id')
      .notNull()
      .references(() => ingredients.id),
    quantity: int('quantity').notNull(),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_recipe_lines').on(t.ownerType, t.ownerId, t.ingredientId)],
);

/** Purchases, waste, adjustments and counts entered by hand. Append-only (triggers). */
export const stockMovements = mysqlTable(
  'stock_movements',
  {
    id: primaryId(),
    organizationId: organizationId(),
    locationId: locationId(),
    ingredientId: uuid('ingredient_id').notNull(),
    /** `purchase`, `waste`, `adjustment` or `count` (MOVEMENT_KINDS). */
    kind: varchar('kind', { length: 16 }).notNull(),
    /** Signed change in stock; a count stores the difference it made. */
    quantity: int('quantity').notNull(),
    /** What was counted, for a count. */
    countedQuantity: int('counted_quantity'),
    note: varchar('note', { length: 200 }),
    userId: uuid('user_id').notNull(),
    occurredAt: utcDatetime('occurred_at').notNull(),
    createdAt: utcDatetime('created_at').notNull(),
  },
  (t) => [index('idx_stock_movements_ingredient').on(t.locationId, t.ingredientId)],
);

/**
 * What sold items took, derived from the orders' operations on every sync (like order_items),
 * one row per item and raw material.
 */
export const stockConsumptions = mysqlTable(
  'stock_consumptions',
  {
    id: primaryId(),
    organizationId: organizationId(),
    locationId: locationId(),
    orderId: uuid('order_id').notNull(),
    orderItemId: uuid('order_item_id').notNull(),
    ingredientId: uuid('ingredient_id').notNull(),
    /** `sale`, `waste` or `returned` (CONSUMPTION_KINDS); returned takes nothing. */
    kind: varchar('kind', { length: 16 }).notNull(),
    /** The frozen recipe: base units per one unit of the item. */
    perUnit: int('per_unit').notNull(),
    quantity: int('quantity').notNull(),
    businessDate: date('business_date', { mode: 'string' }),
    occurredAt: utcDatetime('occurred_at'),
    ...syncColumns(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('uq_stock_consumptions_item').on(t.orderItemId, t.ingredientId),
    index('idx_stock_consumptions_ingredient').on(t.locationId, t.ingredientId),
  ],
);
