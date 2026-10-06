import { date, int, mysqlTable, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { organizationId, primaryId, timestamps, uuid } from '../columns';
import { organizations } from './organization';

/**
 * MWST como datos con vigencia (RF-B12, RF-B13, RN-02, RN-03). Ningún porcentaje vive en el código:
 * la tasa de una línea se resuelve con categoría fiscal + tipo de consumo + fecha de la venta,
 * y queda congelada en `order_items` (RN-04).
 */

/** Categoría fiscal del producto: food, non_alcoholic_beverage, alcoholic_beverage, accommodation, other. */
export const taxCategories = mysqlTable(
  'tax_categories',
  {
    id: primaryId(),
    organizationId: organizationId().references(() => organizations.id),
    key: varchar('key', { length: 32 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_tax_categories_org_key').on(t.organizationId, t.key)],
);

/** Tasa por código y vigencia, en puntos básicos (8,1 % = 810). `validTo` null = vigente. */
export const taxRates = mysqlTable(
  'tax_rates',
  {
    id: primaryId(),
    organizationId: organizationId().references(() => organizations.id),
    code: varchar('code', { length: 16 }).notNull(),
    rateBp: int('rate_bp').notNull(),
    validFrom: date('valid_from', { mode: 'string' }).notNull(),
    validTo: date('valid_to', { mode: 'string' }),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_tax_rates_org_code_from').on(t.organizationId, t.code, t.validFrom)],
);

/** Regla: categoría fiscal + tipo de consumo → código de tasa, con vigencia (RN-03). */
export const taxRules = mysqlTable(
  'tax_rules',
  {
    id: primaryId(),
    organizationId: organizationId().references(() => organizations.id),
    taxCategoryId: uuid('tax_category_id')
      .notNull()
      .references(() => taxCategories.id),
    consumptionType: varchar('consumption_type', { length: 16 }).notNull(),
    rateCode: varchar('rate_code', { length: 16 }).notNull(),
    validFrom: date('valid_from', { mode: 'string' }).notNull(),
    validTo: date('valid_to', { mode: 'string' }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('uq_tax_rules_cat_consumption_from').on(
      t.taxCategoryId,
      t.consumptionType,
      t.validFrom,
    ),
  ],
);
