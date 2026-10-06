import {
  type AnyMySqlColumn,
  boolean,
  char,
  date,
  int,
  mysqlTable,
  smallint,
  text,
  time,
  tinyint,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { organizationId, primaryId, rappen, timestamps, utcDatetime, uuid } from '../columns';
import { kitchenStations, locations, organizations } from './organization';
import { taxCategories } from './tax';
import { users } from './users';

/**
 * Catálogo maestro: uno por organización (RF-B01). Una sola ficha alimenta POS, QR, web y carta
 * impresa (RF-B15). Los textos en el idioma por defecto viven en la ficha; los demás en `translations`.
 */

export const categories = mysqlTable('categories', {
  id: primaryId(),
  organizationId: organizationId().references(() => organizations.id),
  parentId: uuid('parent_id').references((): AnyMySqlColumn => categories.id),
  name: varchar('name', { length: 150 }).notNull(),
  description: text('description'),
  imageUrl: varchar('image_url', { length: 500 }),
  sortOrder: int('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps(),
});

/** Producto con precio en CHF con MWST incluida, en rappen (RF-B04, RN-01). */
export const products = mysqlTable('products', {
  id: primaryId(),
  organizationId: organizationId().references(() => organizations.id),
  categoryId: uuid('category_id')
    .notNull()
    .references(() => categories.id),
  taxCategoryId: uuid('tax_category_id')
    .notNull()
    .references(() => taxCategories.id),
  sku: varchar('sku', { length: 64 }),
  name: varchar('name', { length: 150 }).notNull(),
  description: text('description'),
  /** Precio bruto (MWST incluida). Con variantes, es el precio de la variante por defecto. */
  basePriceRappen: rappen('base_price_rappen'),
  /** Curso por defecto: 0 bebidas, 1 entradas, 2 platos, 3 postres (RF-B11). */
  defaultCourse: smallint('default_course').notNull().default(1),
  imageUrl: varchar('image_url', { length: 500 }),
  /** Lleva carne, ave o pescado: el origen es obligatorio para publicarlo (RF-B06, RN-18). */
  requiresOrigin: boolean('requires_origin').notNull().default(false),
  /** Alérgenos revisados y confirmados, aunque sean cero (RN-18). */
  allergensComplete: boolean('allergens_complete').notNull().default(false),
  publishQr: boolean('publish_qr').notNull().default(true),
  publishWeb: boolean('publish_web').notNull().default(true),
  sortOrder: int('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps(),
});

/** Variante con precio propio: 3 dl / 5 dl, copa / botella (RF-B02). */
export const productVariants = mysqlTable('product_variants', {
  id: primaryId(),
  organizationId: organizationId().references(() => organizations.id),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id),
  name: varchar('name', { length: 100 }).notNull(),
  priceRappen: rappen('price_rappen'),
  isDefault: boolean('is_default').notNull().default(false),
  sortOrder: int('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps(),
});

/** Grupo de modificadores; obligatorio si `minSelect > 0` (RF-B02). */
export const modifierGroups = mysqlTable('modifier_groups', {
  id: primaryId(),
  organizationId: organizationId().references(() => organizations.id),
  name: varchar('name', { length: 100 }).notNull(),
  minSelect: smallint('min_select').notNull().default(0),
  maxSelect: smallint('max_select').notNull().default(1),
  sortOrder: int('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps(),
});

export const modifiers = mysqlTable('modifiers', {
  id: primaryId(),
  organizationId: organizationId().references(() => organizations.id),
  modifierGroupId: uuid('modifier_group_id')
    .notNull()
    .references(() => modifierGroups.id),
  name: varchar('name', { length: 100 }).notNull(),
  priceDeltaRappen: rappen('price_delta_rappen'),
  sortOrder: int('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps(),
});

export const productModifierGroups = mysqlTable(
  'product_modifier_groups',
  {
    id: primaryId(),
    organizationId: organizationId().references(() => organizations.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    modifierGroupId: uuid('modifier_group_id')
      .notNull()
      .references(() => modifierGroups.id),
    sortOrder: int('sort_order').notNull().default(0),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_product_modifier_groups').on(t.productId, t.modifierGroupId)],
);

/** Alérgeno de un producto: clave de `ALLERGENS`; `presence` = contains | may_contain (RF-B05). */
export const productAllergens = mysqlTable(
  'product_allergens',
  {
    id: primaryId(),
    organizationId: organizationId().references(() => organizations.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    allergen: varchar('allergen', { length: 16 }).notNull(),
    presence: varchar('presence', { length: 16 }).notNull().default('contains'),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_product_allergens').on(t.productId, t.allergen)],
);

export const modifierAllergens = mysqlTable(
  'modifier_allergens',
  {
    id: primaryId(),
    organizationId: organizationId().references(() => organizations.id),
    modifierId: uuid('modifier_id')
      .notNull()
      .references(() => modifiers.id),
    allergen: varchar('allergen', { length: 16 }).notNull(),
    presence: varchar('presence', { length: 16 }).notNull().default('contains'),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_modifier_allergens').on(t.modifierId, t.allergen)],
);

/** Origen (país ISO 3166-1 alfa-2) de la carne, el ave o el pescado del producto (RF-B06). */
export const productOrigins = mysqlTable('product_origins', {
  id: primaryId(),
  organizationId: organizationId().references(() => organizations.id),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id),
  kind: varchar('kind', { length: 16 }).notNull(),
  species: varchar('species', { length: 64 }),
  country: char('country', { length: 2 }).notNull(),
  ...timestamps(),
});

/**
 * Traducción de nombre o descripción de una entidad del catálogo (RF-B07). Si falta, se muestra
 * el idioma de la sede. Polimórfica: `entityType` es uno de `TRANSLATABLE_ENTITIES`.
 */
export const translations = mysqlTable(
  'translations',
  {
    id: primaryId(),
    organizationId: organizationId().references(() => organizations.id),
    entityType: varchar('entity_type', { length: 32 }).notNull(),
    entityId: uuid('entity_id').notNull(),
    language: char('language', { length: 2 }).notNull(),
    field: varchar('field', { length: 16 }).notNull(),
    value: text('value').notNull(),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_translations').on(t.entityType, t.entityId, t.language, t.field)],
);

/**
 * Disponibilidad por franja, día y canal (RF-B08). Si un producto (o su categoría) tiene reglas,
 * solo se puede pedir cuando alguna coincide (RN-17). `daysOfWeek`: bitmask lun=1 … dom=64.
 */
export const availabilityRules = mysqlTable('availability_rules', {
  id: primaryId(),
  organizationId: organizationId().references(() => organizations.id),
  locationId: uuid('location_id').references(() => locations.id),
  productId: uuid('product_id').references(() => products.id),
  categoryId: uuid('category_id').references(() => categories.id),
  channel: varchar('channel', { length: 16 }),
  daysOfWeek: tinyint('days_of_week').notNull().default(127),
  startTime: time('start_time'),
  endTime: time('end_time'),
  validFrom: date('valid_from', { mode: 'string' }),
  validTo: date('valid_to', { mode: 'string' }),
  ...timestamps(),
});

/** Precio distinto por canal (y opcionalmente por sede y variante) (RF-B04). */
export const channelPrices = mysqlTable('channel_prices', {
  id: primaryId(),
  organizationId: organizationId().references(() => organizations.id),
  locationId: uuid('location_id').references(() => locations.id),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id),
  variantId: uuid('variant_id').references(() => productVariants.id),
  channel: varchar('channel', { length: 16 }).notNull(),
  priceRappen: rappen('price_rappen'),
  ...timestamps(),
});

/**
 * Ajustes del producto en una sede: activo, precio propio (RF-B01) y agotado "86" con vuelta
 * programada (RF-B09).
 */
export const productLocationSettings = mysqlTable(
  'product_location_settings',
  {
    id: primaryId(),
    organizationId: organizationId().references(() => organizations.id),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    isActive: boolean('is_active').notNull().default(true),
    /** null = usa el precio del catálogo. */
    priceRappen: int('price_rappen'),
    soldOutAt: utcDatetime('sold_out_at'),
    soldOutByUserId: uuid('sold_out_by_user_id').references(() => users.id),
    /** Vuelve a estar disponible automáticamente en este momento (p. ej. al día siguiente). */
    soldOutUntil: utcDatetime('sold_out_until'),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_product_location_settings').on(t.locationId, t.productId)],
);

/** Ruteo del producto a una o varias estaciones de cocina de la sede (RF-B11, RF-C21). */
export const productStationRoutes = mysqlTable(
  'product_station_routes',
  {
    id: primaryId(),
    organizationId: organizationId().references(() => organizations.id),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    kitchenStationId: uuid('kitchen_station_id')
      .notNull()
      .references(() => kitchenStations.id),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('uq_product_station_routes').on(t.locationId, t.productId, t.kitchenStationId),
  ],
);
