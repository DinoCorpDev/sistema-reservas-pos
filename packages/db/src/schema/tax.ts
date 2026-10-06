import { date, int, mysqlTable, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { organizationId, primaryId, timestamps, uuid } from '../columns';
import { organizations } from './organization';

/**
 * MWST as data with validity periods (RF-B12, RF-B13, RN-02, RN-03). No percentage lives in code:
 * a line's rate is resolved from tax category + consumption type + sale date,
 * and stays frozen in `order_items` (RN-04).
 */

/** Product tax category: food, non_alcoholic_beverage, alcoholic_beverage, accommodation, other. */
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

/** Rate per code and validity period, in basis points (8.1 % = 810). `validTo` null = current. */
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

/** Rule: tax category + consumption type → rate code, with a validity period (RN-03). */
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
