import { createRoute, z } from '@hono/zod-openapi';
import {
  CONSUMPTION_KINDS,
  createIngredientSchema,
  MOVEMENT_KINDS,
  RECIPE_OWNER_TYPES,
  recordMovementSchema,
  replaceRecipeSchema,
  STOCK_UNITS,
  updateIngredientSchema,
} from '@pos/core';
import * as service from '../../services/inventory';
import type { ServiceDeps } from '../../services/shared';
import { actorOf, type ApiApp, type ApiContext } from '../env';
import {
  AUTHENTICATED,
  ERROR_RESPONSES,
  jsonBody,
  jsonResponse,
  NoContent,
  UuidParam,
} from '../schemas';

// Input schemas come from @pos/core as plain Zod: never call `.openapi()` on them.

const tags = ['Inventory'];
const security = AUTHENTICATED;
const deps = (c: ApiContext): ServiceDeps => ({ db: c.get('db') });

const quantity = (description: string) => z.number().int().openapi({ description });

const IngredientSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    unit: z.string().openapi({ enum: [...STOCK_UNITS] }),
    lowStockThreshold: quantity('Warn at or under this stock (base units)').nullable(),
    isActive: z.boolean(),
    onHand: quantity('Stock at the current location (base units)').nullable(),
    isLow: z.boolean(),
  })
  .openapi('Ingredient', {
    description: 'A raw material; quantities in whole grams, millilitres or pieces (DEC-051)',
  });

const MovementSchema = z
  .object({
    id: z.uuid(),
    kind: z.string().openapi({ enum: [...MOVEMENT_KINDS] }),
    quantity: quantity('Signed change in stock'),
    countedQuantity: quantity('What was counted').nullable(),
    note: z.string().nullable(),
    userName: z.string().nullable(),
    occurredAt: z.string(),
  })
  .openapi('StockMovement');

const HistorySchema = z
  .object({
    ingredient: IngredientSchema,
    movements: z.array(MovementSchema),
    days: z.array(
      z.object({
        businessDate: z.string(),
        sold: quantity('Taken by sales'),
        wasted: quantity(`Taken by kitchen waste (${CONSUMPTION_KINDS.join(', ')})`),
      }),
    ),
  })
  .openapi('IngredientHistory');

const RecipeLineSchema = z.object({ ingredientId: z.uuid(), quantity: quantity('Per unit') });
const RecipeOwnerSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  isActive: z.boolean(),
  lines: z.array(RecipeLineSchema),
});
const RecipesSchema = z
  .object({
    products: z.array(
      RecipeOwnerSchema.extend({
        categoryName: z.string(),
        variants: z.array(RecipeOwnerSchema),
      }),
    ),
    modifiers: z.array(RecipeOwnerSchema.extend({ groupName: z.string() })),
  })
  .openapi('Recipes');

const RecipeOwnerParam = z.object({
  ownerType: z.enum(RECIPE_OWNER_TYPES).openapi({ param: { name: 'ownerType', in: 'path' } }),
  ownerId: z.uuid().openapi({ param: { name: 'ownerId', in: 'path' } }),
});

export function registerInventoryRoutes(app: ApiApp) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/inventory/ingredients',
      tags,
      security,
      summary: 'Raw materials with their stock at the current location, the low ones first',
      responses: {
        200: jsonResponse(z.array(IngredientSchema), 'Raw materials'),
        ...ERROR_RESPONSES,
      },
    }),
    async (c) => c.json(await service.listIngredients(deps(c), actorOf(c)), 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/inventory/ingredients',
      tags,
      security,
      summary: 'Create a raw material',
      request: { body: jsonBody(createIngredientSchema) },
      responses: { 201: jsonResponse(IngredientSchema, 'Created'), ...ERROR_RESPONSES },
    }),
    async (c) =>
      c.json(await service.createIngredient(deps(c), actorOf(c), c.req.valid('json')), 201),
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/inventory/ingredients/{id}',
      tags,
      security,
      summary: 'Rename a raw material, change its low level or deactivate it',
      request: { params: UuidParam, body: jsonBody(updateIngredientSchema) },
      responses: { 200: jsonResponse(IngredientSchema, 'Updated'), ...ERROR_RESPONSES },
    }),
    async (c) =>
      c.json(
        await service.updateIngredient(
          deps(c),
          actorOf(c),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/inventory/ingredients/{id}',
      tags,
      security,
      summary: 'Remove a raw material no recipe uses (soft delete)',
      request: { params: UuidParam },
      responses: { 204: NoContent, ...ERROR_RESPONSES },
    }),
    async (c) => {
      await service.deleteIngredient(deps(c), actorOf(c), c.req.valid('param').id);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/inventory/ingredients/{id}/movements',
      tags,
      security,
      summary: 'Movements by hand and what sales took per day',
      request: { params: UuidParam },
      responses: { 200: jsonResponse(HistorySchema, 'History'), ...ERROR_RESPONSES },
    }),
    async (c) =>
      c.json(await service.ingredientHistory(deps(c), actorOf(c), c.req.valid('param').id), 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/inventory/ingredients/{id}/movements',
      tags,
      security,
      summary: 'Record a purchase, waste, adjustment or count',
      request: { params: UuidParam, body: jsonBody(recordMovementSchema) },
      responses: { 201: jsonResponse(IngredientSchema, 'Stock after it'), ...ERROR_RESPONSES },
    }),
    async (c) =>
      c.json(
        await service.recordMovement(
          deps(c),
          actorOf(c),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
        201,
      ),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/inventory/recipes',
      tags,
      security,
      summary: 'Products, variants and modifier options with what they use',
      responses: { 200: jsonResponse(RecipesSchema, 'Recipes'), ...ERROR_RESPONSES },
    }),
    async (c) => c.json(await service.listRecipes(deps(c), actorOf(c)), 200),
  );

  app.openapi(
    createRoute({
      method: 'put',
      path: '/inventory/recipes/{ownerType}/{ownerId}',
      tags,
      security,
      summary: 'Replace the recipe of a product, variant or modifier option',
      request: { params: RecipeOwnerParam, body: jsonBody(replaceRecipeSchema) },
      responses: {
        200: jsonResponse(z.array(RecipeLineSchema), 'The recipe'),
        ...ERROR_RESPONSES,
      },
    }),
    async (c) => {
      const { ownerType, ownerId } = c.req.valid('param');
      return c.json(
        await service.replaceRecipe(deps(c), actorOf(c), ownerType, ownerId, c.req.valid('json')),
        200,
      );
    },
  );
}
