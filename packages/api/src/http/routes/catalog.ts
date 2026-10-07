import { createRoute, z } from '@hono/zod-openapi';
import {
  ALLERGEN_PRESENCES,
  ALLERGENS,
  createCategorySchema,
  createModifierGroupSchema,
  createProductSchema,
  listProductsQuerySchema,
  markSoldOutSchema,
  menuQuerySchema,
  nameTranslationsSchema,
  productLocationSettingsSchema,
  replaceAllergensSchema,
  replaceAvailabilitySchema,
  replaceChannelPricesSchema,
  replaceModifiersSchema,
  replaceOriginsSchema,
  replaceProductModifierGroupsSchema,
  replaceProductStationsSchema,
  replaceVariantsSchema,
  textTranslationsSchema,
  updateCategorySchema,
  updateModifierGroupSchema,
  updateProductSchema,
} from '@pos/core';
import * as service from '../../services/catalog';
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

const TranslationsSchema = z
  .record(z.string(), z.object({ name: z.string().optional(), description: z.string().optional() }))
  .openapi('CatalogTranslations', { example: { fr: { name: 'Menu du jour' } } });

const LabelsSchema = z.record(z.string(), z.string()).openapi({ example: { fr: 'Menu du jour' } });

const AllergenSchema = z.object({
  allergen: z.string().openapi({ enum: [...ALLERGENS] }),
  presence: z.string().openapi({ enum: [...ALLERGEN_PRESENCES] }),
});

const PublicationSchema = z
  .object({
    publishable: z.boolean(),
    issues: z.array(z.string().openapi({ enum: ['allergens_missing', 'origin_missing'] })),
  })
  .openapi({ description: 'RN-18: QR and web show the product only when publishable' });

const CategorySchema = z
  .object({
    id: z.uuid(),
    parentId: z.uuid().nullable(),
    name: z.string(),
    description: z.string().nullable(),
    imageUrl: z.string().nullable(),
    sortOrder: z.number().int(),
    isActive: z.boolean(),
    translations: TranslationsSchema,
  })
  .openapi('Category');

const productBase = {
  id: z.uuid(),
  categoryId: z.uuid(),
  taxCategoryId: z.uuid(),
  sku: z.string().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  basePriceRappen: z
    .number()
    .int()
    .openapi({ description: 'Gross price in rappen, MWST included' }),
  defaultCourse: z.number().int(),
  imageUrl: z.string().nullable(),
  requiresOrigin: z.boolean(),
  allergensComplete: z.boolean(),
  publishQr: z.boolean(),
  publishWeb: z.boolean(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
};

const ProductSummarySchema = z
  .object({ ...productBase, publication: PublicationSchema })
  .openapi('ProductSummary');

const ProductLocationSettingsSchema = z
  .object({
    locationId: z.uuid(),
    isActive: z.boolean(),
    priceRappen: z.number().int().nullable().openapi({ description: 'null = catalog price' }),
    soldOutAt: z.string().nullable(),
    soldOutUntil: z.string().nullable(),
    isSoldOut: z.boolean(),
  })
  .openapi('ProductLocationSettings');

const ProductSchema = z
  .object({
    ...productBase,
    variants: z.array(
      z.object({
        id: z.uuid(),
        name: z.string(),
        priceRappen: z.number().int(),
        isDefault: z.boolean(),
        sortOrder: z.number().int(),
        isActive: z.boolean(),
        translations: LabelsSchema,
      }),
    ),
    modifierGroupIds: z.array(z.uuid()),
    allergens: z.array(AllergenSchema),
    origins: z.array(
      z.object({
        id: z.uuid(),
        kind: z.string(),
        species: z.string().nullable(),
        country: z.string(),
      }),
    ),
    translations: TranslationsSchema,
    availability: z.array(
      z.object({
        id: z.uuid(),
        locationId: z.uuid().nullable(),
        channel: z.string().nullable(),
        daysOfWeek: z.number().int(),
        startTime: z.string().nullable(),
        endTime: z.string().nullable(),
        validFrom: z.string().nullable(),
        validTo: z.string().nullable(),
      }),
    ),
    channelPrices: z.array(
      z.object({
        id: z.uuid(),
        channel: z.string(),
        locationId: z.uuid().nullable(),
        variantId: z.uuid().nullable(),
        priceRappen: z.number().int(),
      }),
    ),
    locationSettings: ProductLocationSettingsSchema.nullable().openapi({
      description: 'The product at the caller’s current location; null without a location',
    }),
    stationIds: z
      .array(z.uuid())
      .openapi({ description: 'Kitchen stations at the current location' }),
    publication: PublicationSchema,
  })
  .openapi('Product');

const ModifierGroupSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    minSelect: z.number().int(),
    maxSelect: z.number().int(),
    sortOrder: z.number().int(),
    isActive: z.boolean(),
    translations: TranslationsSchema,
    modifiers: z.array(
      z.object({
        id: z.uuid(),
        name: z.string(),
        priceDeltaRappen: z.number().int(),
        sortOrder: z.number().int(),
        isActive: z.boolean(),
        allergens: z.array(AllergenSchema),
        translations: LabelsSchema,
      }),
    ),
  })
  .openapi('ModifierGroup');

const MenuProductSchema = z
  .object({
    id: z.uuid(),
    categoryId: z.uuid(),
    taxCategoryId: z.uuid(),
    taxCategoryKey: z.string().openapi({ description: 'Tax category (food, alcoholic_beverage…)' }),
    sku: z.string().nullable(),
    name: z.string(),
    description: z.string().nullable(),
    imageUrl: z.string().nullable(),
    defaultCourse: z.number().int(),
    stationIds: z
      .array(z.uuid())
      .openapi({ description: 'Kitchen stations the product is routed to (RF-B11)' }),
    priceRappen: z
      .number()
      .int()
      .openapi({ description: 'Resolved gross price of the default variant' }),
    variants: z.array(
      z.object({
        id: z.uuid(),
        name: z.string(),
        priceRappen: z.number().int(),
        isDefault: z.boolean(),
      }),
    ),
    allergens: z.array(AllergenSchema),
    origins: z.array(
      z.object({ kind: z.string(), species: z.string().nullable(), country: z.string() }),
    ),
    modifierGroups: z.array(
      z.object({
        id: z.uuid(),
        name: z.string(),
        minSelect: z.number().int(),
        maxSelect: z.number().int(),
        modifiers: z.array(
          z.object({
            id: z.uuid(),
            name: z.string(),
            priceDeltaRappen: z.number().int(),
            allergens: z.array(AllergenSchema),
          }),
        ),
      }),
    ),
    orderable: z.boolean(),
    reason: z.string().nullable().openapi({
      description:
        'Why it cannot be ordered now (RN-17): inactive, inactive_at_location, sold_out, not_available_now, not_available_on_channel',
    }),
  })
  .openapi('MenuProduct');

const MenuSchema = z
  .object({
    locationId: z.uuid(),
    channel: z.string(),
    language: z.string(),
    at: z.string(),
    categories: z.array(
      z.object({
        id: z.uuid(),
        parentId: z.uuid().nullable(),
        name: z.string(),
        description: z.string().nullable(),
        imageUrl: z.string().nullable(),
        products: z.array(MenuProductSchema),
      }),
    ),
  })
  .openapi('Menu');

const tags = ['Catalog'];
const security = AUTHENTICATED;

const deps = (c: ApiContext): ServiceDeps => ({ db: c.get('db') });

/** PUT /catalog/products/{id}/<collection>: replaces one collection, answers with the product. */
const replaceRoute = <P extends string, S extends z.ZodType>(
  collection: P,
  body: S,
  summary: string,
  description: string,
) =>
  createRoute({
    method: 'put',
    path: `/catalog/products/{id}/${collection}` as `/catalog/products/{id}/${P}`,
    tags,
    security,
    summary,
    description,
    request: { params: UuidParam, body: jsonBody(body) },
    responses: { 200: jsonResponse(ProductSchema, 'Updated product'), ...ERROR_RESPONSES },
  });

export function registerCatalogRoutes(app: ApiApp) {
  // ── Categories ────────────────────────────────────────────────────────────

  app.openapi(
    createRoute({
      method: 'get',
      path: '/catalog/categories',
      tags,
      security,
      summary: 'List the categories of the catalog (RF-B02)',
      responses: { 200: jsonResponse(z.array(CategorySchema), 'Categories'), ...ERROR_RESPONSES },
    }),
    async (c) => c.json(await service.listCategories(deps(c), actorOf(c)), 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/catalog/categories',
      tags,
      security,
      summary: 'Create a category (RF-B02)',
      request: { body: jsonBody(createCategorySchema) },
      responses: { 201: jsonResponse(CategorySchema, 'Created category'), ...ERROR_RESPONSES },
    }),
    async (c) =>
      c.json(await service.createCategory(deps(c), actorOf(c), c.req.valid('json')), 201),
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/catalog/categories/{id}',
      tags,
      security,
      summary: 'Update or (de)activate a category',
      description: 'Deactivating hides all its products on every channel; audited (RF-B17).',
      request: { params: UuidParam, body: jsonBody(updateCategorySchema) },
      responses: { 200: jsonResponse(CategorySchema, 'Updated category'), ...ERROR_RESPONSES },
    }),
    async (c) =>
      c.json(
        await service.updateCategory(
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
      path: '/catalog/categories/{id}',
      tags,
      security,
      summary: 'Remove an empty category (soft delete)',
      request: { params: UuidParam },
      responses: { 204: NoContent, ...ERROR_RESPONSES },
    }),
    async (c) => {
      await service.deleteCategory(deps(c), actorOf(c), c.req.valid('param').id);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: 'put',
      path: '/catalog/categories/{id}/translations',
      tags,
      security,
      summary: 'Replace the translations of a category (RF-B07)',
      request: { params: UuidParam, body: jsonBody(textTranslationsSchema) },
      responses: { 200: jsonResponse(CategorySchema, 'Category'), ...ERROR_RESPONSES },
    }),
    async (c) =>
      c.json(
        await service.replaceCategoryTranslations(
          deps(c),
          actorOf(c),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
        200,
      ),
  );

  // ── Products ──────────────────────────────────────────────────────────────

  app.openapi(
    createRoute({
      method: 'get',
      path: '/catalog/products',
      tags,
      security,
      summary: 'List products (RF-B01)',
      description:
        'Filter by category or by a search on name and SKU; inactive products only on request.',
      request: { query: listProductsQuerySchema },
      responses: {
        200: jsonResponse(z.array(ProductSummarySchema), 'Products'),
        ...ERROR_RESPONSES,
      },
    }),
    async (c) => c.json(await service.listProducts(deps(c), actorOf(c), c.req.valid('query')), 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/catalog/products',
      tags,
      security,
      summary: 'Create a product (RF-B01, RF-B12)',
      description:
        'Starts unpublished on QR and web until allergens (and origin) are complete (RN-18).',
      request: { body: jsonBody(createProductSchema) },
      responses: { 201: jsonResponse(ProductSchema, 'Created product'), ...ERROR_RESPONSES },
    }),
    async (c) => c.json(await service.createProduct(deps(c), actorOf(c), c.req.valid('json')), 201),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/catalog/products/{id}',
      tags,
      security,
      summary: 'Get the full product',
      description:
        'Variants, modifiers, allergens, origin, translations, availability, channel prices, the ' +
        'settings and stations at the current location, and the publication check (RN-18).',
      request: { params: UuidParam },
      responses: { 200: jsonResponse(ProductSchema, 'Product'), ...ERROR_RESPONSES },
    }),
    async (c) =>
      c.json(await service.getProduct(deps(c), actorOf(c), c.req.valid('param').id), 200),
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/catalog/products/{id}',
      tags,
      security,
      summary: 'Update a product',
      description:
        'A price change needs catalog.price_change. Price, tax category and availability changes are ' +
        'audited with before and after (RF-B17). Publishing to QR or web is refused while allergens or ' +
        'origin are missing (422 RULE_VIOLATION, RN-18).',
      request: { params: UuidParam, body: jsonBody(updateProductSchema) },
      responses: { 200: jsonResponse(ProductSchema, 'Updated product'), ...ERROR_RESPONSES },
    }),
    async (c) =>
      c.json(
        await service.updateProduct(
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
      path: '/catalog/products/{id}',
      tags,
      security,
      summary: 'Remove a product (soft delete)',
      request: { params: UuidParam },
      responses: { 204: NoContent, ...ERROR_RESPONSES },
    }),
    async (c) => {
      await service.deleteProduct(deps(c), actorOf(c), c.req.valid('param').id);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/catalog/products/{id}/duplicate',
      tags,
      security,
      summary: 'Duplicate a product (RF-B18)',
      description:
        'Copies variants, allergens, origin, translations, modifier groups, channel prices, ' +
        'availability and station routes. The copy is inactive and named "… (Kopie)".',
      request: { params: UuidParam },
      responses: { 201: jsonResponse(ProductSchema, 'The copy'), ...ERROR_RESPONSES },
    }),
    async (c) =>
      c.json(await service.duplicateProduct(deps(c), actorOf(c), c.req.valid('param').id), 201),
  );

  // PUT endpoints that replace one collection of the product and answer with the full product.

  app.openapi(
    replaceRoute(
      'variants',
      replaceVariantsSchema,
      'Replace the variants (RF-B02)',
      'Rows without a known id are created; missing ones are removed. The catalog price follows the ' +
        'default variant. New or changed prices need catalog.price_change and are audited (RF-B17).',
    ),
    async (c) =>
      c.json(
        await service.replaceVariants(
          deps(c),
          actorOf(c),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
        200,
      ),
  );

  app.openapi(
    replaceRoute(
      'allergens',
      replaceAllergensSchema,
      'Replace the allergens (RF-B05)',
      '`confirmed` marks the list as reviewed and complete, even if empty (RN-18).',
    ),
    async (c) =>
      c.json(
        await service.replaceAllergens(
          deps(c),
          actorOf(c),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
        200,
      ),
  );

  app.openapi(
    replaceRoute(
      'origins',
      replaceOriginsSchema,
      'Replace the origin of meat, poultry and fish (RF-B06)',
      'Country as ISO 3166-1 alpha-2. Required to publish when the product requires origin (RN-18).',
    ),
    async (c) =>
      c.json(
        await service.replaceOrigins(
          deps(c),
          actorOf(c),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
        200,
      ),
  );

  app.openapi(
    replaceRoute(
      'translations',
      textTranslationsSchema,
      'Replace the translations (RF-B07)',
      'Name and description per language; a missing language is removed and falls back to the ' +
        'location language.',
    ),
    async (c) =>
      c.json(
        await service.replaceProductTranslations(
          deps(c),
          actorOf(c),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
        200,
      ),
  );

  app.openapi(
    replaceRoute(
      'modifier-groups',
      replaceProductModifierGroupsSchema,
      'Replace the modifier groups of the product, in order (RF-B02)',
      'Ids of modifier groups of the organization.',
    ),
    async (c) =>
      c.json(
        await service.replaceProductModifierGroups(
          deps(c),
          actorOf(c),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
        200,
      ),
  );

  app.openapi(
    replaceRoute(
      'availability',
      replaceAvailabilitySchema,
      'Replace the availability rules (RF-B08)',
      'Weekdays (bitmask Monday = 1 … Sunday = 64), local time window, channel, location and validity ' +
        'dates. With rules, the product can only be ordered when one matches (RN-17). Audited.',
    ),
    async (c) =>
      c.json(
        await service.replaceAvailability(
          deps(c),
          actorOf(c),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
        200,
      ),
  );

  app.openapi(
    replaceRoute(
      'channel-prices',
      replaceChannelPricesSchema,
      'Replace the prices per channel (RF-B04)',
      'Optionally per location and variant. Needs catalog.price_change; audited (RF-B17).',
    ),
    async (c) =>
      c.json(
        await service.replaceChannelPrices(
          deps(c),
          actorOf(c),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
        200,
      ),
  );

  app.openapi(
    replaceRoute(
      'stations',
      replaceProductStationsSchema,
      'Replace the kitchen stations of the product at the current location (RF-B11)',
      'The stations must belong to the current location.',
    ),
    async (c) =>
      c.json(
        await service.replaceProductStations(
          deps(c),
          actorOf(c),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
        200,
      ),
  );

  app.openapi(
    replaceRoute(
      'location-settings',
      productLocationSettingsSchema,
      'Activate the product and set its own price at the current location (RF-B01)',
      'priceRappen null = catalog price. A price change needs catalog.price_change; audited (RF-B17).',
    ),
    async (c) =>
      c.json(
        await service.updateProductLocationSettings(
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
      method: 'post',
      path: '/catalog/products/{id}/sold-out',
      tags,
      security,
      summary: 'Mark the product as sold out at the current location, "86" (RF-B09)',
      description:
        'It stops being orderable at once on every channel (RN-17). `until` or `nextBusinessDay` ' +
        '(04:00 local) bring it back automatically. Needs catalog.sold_out.',
      request: { params: UuidParam, body: jsonBody(markSoldOutSchema) },
      responses: { 200: jsonResponse(ProductSchema, 'Product'), ...ERROR_RESPONSES },
    }),
    async (c) =>
      c.json(
        await service.markSoldOut(
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
      path: '/catalog/products/{id}/sold-out',
      tags,
      security,
      summary: 'Make the product available again at the current location (RF-B09)',
      request: { params: UuidParam },
      responses: { 200: jsonResponse(ProductSchema, 'Product'), ...ERROR_RESPONSES },
    }),
    async (c) =>
      c.json(await service.restoreSoldOut(deps(c), actorOf(c), c.req.valid('param').id), 200),
  );

  // ── Modifier groups ───────────────────────────────────────────────────────

  app.openapi(
    createRoute({
      method: 'get',
      path: '/catalog/modifier-groups',
      tags,
      security,
      summary: 'List modifier groups with their modifiers (RF-B02)',
      responses: {
        200: jsonResponse(z.array(ModifierGroupSchema), 'Modifier groups'),
        ...ERROR_RESPONSES,
      },
    }),
    async (c) => c.json(await service.listModifierGroups(deps(c), actorOf(c)), 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/catalog/modifier-groups',
      tags,
      security,
      summary: 'Create a modifier group (RF-B02)',
      description: 'Mandatory when minSelect > 0; minSelect must not exceed maxSelect.',
      request: { body: jsonBody(createModifierGroupSchema) },
      responses: {
        201: jsonResponse(ModifierGroupSchema, 'Created modifier group'),
        ...ERROR_RESPONSES,
      },
    }),
    async (c) =>
      c.json(await service.createModifierGroup(deps(c), actorOf(c), c.req.valid('json')), 201),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/catalog/modifier-groups/{id}',
      tags,
      security,
      summary: 'Get a modifier group',
      request: { params: UuidParam },
      responses: { 200: jsonResponse(ModifierGroupSchema, 'Modifier group'), ...ERROR_RESPONSES },
    }),
    async (c) =>
      c.json(await service.getModifierGroup(deps(c), actorOf(c), c.req.valid('param').id), 200),
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/catalog/modifier-groups/{id}',
      tags,
      security,
      summary: 'Update a modifier group',
      request: { params: UuidParam, body: jsonBody(updateModifierGroupSchema) },
      responses: {
        200: jsonResponse(ModifierGroupSchema, 'Updated modifier group'),
        ...ERROR_RESPONSES,
      },
    }),
    async (c) =>
      c.json(
        await service.updateModifierGroup(
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
      path: '/catalog/modifier-groups/{id}',
      tags,
      security,
      summary: 'Remove a modifier group no product uses (soft delete)',
      request: { params: UuidParam },
      responses: { 204: NoContent, ...ERROR_RESPONSES },
    }),
    async (c) => {
      await service.deleteModifierGroup(deps(c), actorOf(c), c.req.valid('param').id);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: 'put',
      path: '/catalog/modifier-groups/{id}/modifiers',
      tags,
      security,
      summary: 'Replace the modifiers of a group (RF-B02, RF-B05)',
      description:
        'With surcharge, allergens and translations. A changed surcharge needs catalog.price_change.',
      request: { params: UuidParam, body: jsonBody(replaceModifiersSchema) },
      responses: { 200: jsonResponse(ModifierGroupSchema, 'Modifier group'), ...ERROR_RESPONSES },
    }),
    async (c) =>
      c.json(
        await service.replaceModifiers(
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
      method: 'put',
      path: '/catalog/modifier-groups/{id}/translations',
      tags,
      security,
      summary: 'Replace the translations of a modifier group (RF-B07)',
      request: { params: UuidParam, body: jsonBody(nameTranslationsSchema) },
      responses: { 200: jsonResponse(ModifierGroupSchema, 'Modifier group'), ...ERROR_RESPONSES },
    }),
    async (c) =>
      c.json(
        await service.replaceModifierGroupTranslations(
          deps(c),
          actorOf(c),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
        200,
      ),
  );

  // ── Menu ──────────────────────────────────────────────────────────────────

  app.openapi(
    createRoute({
      method: 'get',
      path: '/catalog/menu',
      tags,
      security,
      summary: 'Menu of the current location for a channel and language (RF-B15, RF-E06, RF-F14)',
      description:
        'Active categories and products with translated texts, resolved gross prices per variant, ' +
        'allergens, origin and modifiers, and whether each product can be ordered at `at` (default now) ' +
        'with the reason if not (RN-17). QR and web only list publishable products (RN-18). API keys ' +
        'need the catalog:read scope and X-Location-Id.',
      request: { query: menuQuerySchema },
      responses: { 200: jsonResponse(MenuSchema, 'Menu'), ...ERROR_RESPONSES },
    }),
    async (c) => c.json(await service.getMenu(deps(c), actorOf(c), c.req.valid('query')), 200),
  );
}
