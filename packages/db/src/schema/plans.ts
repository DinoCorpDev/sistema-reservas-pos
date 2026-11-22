import {
  boolean,
  char,
  int,
  mysqlTable,
  smallint,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { json, organizationId, primaryId, timestamps, utcDatetime } from '../columns';
import { organizations } from './organization';

/**
 * Plans and add-ons (DEC-045). The catalog is platform data that DINOLABS edits in /support; each
 * organization has one subscription (plan, add-ons, state). Prices are per country and currency,
 * in minor units, for display and manual invoicing: payment happens outside the POS for now.
 */

/** A plan: its limits (null = none) and modules, as JSON validated by the core. */
export const plans = mysqlTable(
  'plans',
  {
    id: primaryId(),
    code: varchar('code', { length: 32 }).notNull(),
    name: varchar('name', { length: 64 }).notNull(),
    limits: json('limits').notNull(),
    features: json('features').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: smallint('sort_order').notNull().default(0),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_plans_code').on(t.code)],
);

/** An add-on: what one unit adds to the limits and which modules it switches on. */
export const planAddons = mysqlTable(
  'plan_addons',
  {
    id: primaryId(),
    code: varchar('code', { length: 32 }).notNull(),
    name: varchar('name', { length: 64 }).notNull(),
    adds: json('adds').notNull(),
    features: json('features').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_plan_addons_code').on(t.code)],
);

/** Monthly price of a plan or an add-on in one country and currency (minor units: rappen, centavos). */
export const planPrices = mysqlTable(
  'plan_prices',
  {
    id: primaryId(),
    /** `plan` or `addon`. */
    itemType: varchar('item_type', { length: 8 }).notNull(),
    itemCode: varchar('item_code', { length: 32 }).notNull(),
    country: char('country', { length: 2 }).notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    amountMinor: int('amount_minor').notNull(),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_plan_prices_item').on(t.itemType, t.itemCode, t.country, t.currency)],
);

/** What an organization bought: one row each. No row = Pro (organizations before plans). */
export const subscriptions = mysqlTable(
  'subscriptions',
  {
    id: primaryId(),
    organizationId: organizationId().references(() => organizations.id),
    planCode: varchar('plan_code', { length: 32 }).notNull(),
    /** `active`, `past_due` or `suspended` (core SUBSCRIPTION_STATUSES). */
    status: varchar('status', { length: 16 }).notNull().default('active'),
    statusSince: utcDatetime('status_since').notNull(),
    note: varchar('note', { length: 500 }),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_subscriptions_organization').on(t.organizationId)],
);

/** The add-ons of a subscription and how many of each. */
export const subscriptionAddons = mysqlTable(
  'subscription_addons',
  {
    id: primaryId(),
    organizationId: organizationId().references(() => organizations.id),
    addonCode: varchar('addon_code', { length: 32 }).notNull(),
    quantity: int('quantity').notNull(),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_subscription_addons').on(t.organizationId, t.addonCode)],
);
