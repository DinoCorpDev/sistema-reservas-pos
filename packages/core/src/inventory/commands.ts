import { z } from 'zod';
import { patchOf } from '../shared/schema';
import { RECIPE_OWNER_TYPES } from './recipes';
import { MAX_STOCK_QUANTITY, STOCK_UNITS } from './units';

/**
 * Input schemas of the inventory commands (DEC-051), shared by the REST API and the backoffice.
 * Quantities are whole base units (g, ml, pieces); the screens convert from kg and litres.
 */

const text = (max: number) => z.string().trim().min(1).max(max);
const quantity = z.int().min(0).max(MAX_STOCK_QUANTITY);
const positive = z.int().min(1).max(MAX_STOCK_QUANTITY);

export const createIngredientSchema = z.object({
  name: text(100),
  unit: z.enum(STOCK_UNITS),
  /** Warn at or under this stock; null for never. */
  lowStockThreshold: quantity.nullable().default(null),
  isActive: z.boolean().default(true),
});

/** The unit is fixed once created: every movement and recipe was written in it. */
export const updateIngredientSchema = patchOf(createIngredientSchema.omit({ unit: true }));

export const recipeOwnerSchema = z.enum(RECIPE_OWNER_TYPES);

export const replaceRecipeSchema = z.object({
  lines: z
    .array(z.object({ ingredientId: z.uuid(), quantity: positive }))
    .max(30)
    .refine(
      (lines) => new Set(lines.map((l) => l.ingredientId)).size === lines.length,
      'Duplicate ingredient',
    ),
});

const note = z.string().trim().max(200).nullable().default(null);

/** Purchase and waste take what came or went; an adjustment is signed; a count, what there is. */
export const recordMovementSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('purchase'), quantity: positive, note }),
  z.object({ kind: z.literal('waste'), quantity: positive, note }),
  z.object({
    kind: z.literal('adjustment'),
    quantity: z
      .int()
      .min(-MAX_STOCK_QUANTITY)
      .max(MAX_STOCK_QUANTITY)
      .refine((q) => q !== 0, 'Zero'),
    note,
  }),
  z.object({ kind: z.literal('count'), quantity, note }),
]);
