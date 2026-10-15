import { z } from 'zod';

/**
 * Plans and add-ons (DEC-045): what an establishment bought decides what it may add — devices,
 * users, locations — and which modules it may use. Data, not code: DINOLABS edits the catalog
 * and each organization's subscription in /support; prices live next to it per country and
 * currency. What is legal never depends on the plan: sales, receipts, the Z and the exports work
 * in every plan and every subscription state. Pure.
 */

export const PLAN_FEATURES = [
  'kds',
  'handhelds',
  'phones',
  'table_ownership',
  'api',
  'multi_location',
] as const;
export type PlanFeature = (typeof PLAN_FEATURES)[number];

export const PLAN_LIMITS = ['devices', 'users', 'locations'] as const;
export type PlanLimit = (typeof PLAN_LIMITS)[number];

/** `active`: normal. `past_due`: a payment is late, a notice shows. `suspended`: nothing new. */
export const SUBSCRIPTION_STATUSES = ['active', 'past_due', 'suspended'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** null = no limit. */
export type PlanLimits = Record<PlanLimit, number | null>;

export interface PlanDefinition {
  code: string;
  name: string;
  limits: PlanLimits;
  features: readonly PlanFeature[];
}

export interface AddonDefinition {
  code: string;
  name: string;
  /** Per unit bought, e.g. `{ devices: 1 }`. */
  adds: Partial<Record<PlanLimit, number>>;
  /** Modules the add-on switches on (e.g. the API). */
  features: readonly PlanFeature[];
}

export interface Entitlements {
  plan: string;
  status: SubscriptionStatus;
  limits: PlanLimits;
  features: ReadonlySet<PlanFeature>;
}

/** The plan plus what each add-on adds, times its quantity. */
export function entitlementsOf(
  plan: PlanDefinition,
  addons: readonly { addon: AddonDefinition; quantity: number }[],
  status: SubscriptionStatus = 'active',
): Entitlements {
  const limits = { ...plan.limits };
  const features = new Set<PlanFeature>(plan.features);
  for (const { addon, quantity } of addons) {
    if (quantity <= 0) continue;
    for (const limit of PLAN_LIMITS) {
      const extra = addon.adds[limit];
      if (extra && limits[limit] !== null) limits[limit] = limits[limit]! + extra * quantity;
    }
    for (const feature of addon.features) features.add(feature);
  }
  return { plan: plan.code, status, limits, features };
}

/** The module a device type needs (a POS needs none; the hub is not a device of the plan). */
export function featureForDevice(type: string): PlanFeature | null {
  switch (type) {
    case 'kds':
      return 'kds';
    case 'handheld':
      return 'handhelds';
    case 'phone':
      return 'phones';
    default:
      return null;
  }
}

/** The hub belongs to the location, not to the plan's device count. */
export const countsAsDevice = (type: string) => type !== 'hub';

export type GrowthRefusal =
  | { reason: 'subscription_suspended' }
  | { reason: 'plan_feature'; feature: PlanFeature }
  | { reason: 'plan_limit'; limit: PlanLimit; allowed: number; used: number };

/**
 * Whether one more `limit` (with `feature`, if any) fits: null when it does, else why not. A
 * suspended subscription adds nothing; current data is never touched.
 */
export function refuseGrowth(
  entitlements: Entitlements,
  limit: PlanLimit,
  used: number,
  feature: PlanFeature | null = null,
): GrowthRefusal | null {
  if (entitlements.status === 'suspended') return { reason: 'subscription_suspended' };
  if (feature && !entitlements.features.has(feature)) return { reason: 'plan_feature', feature };
  const allowed = entitlements.limits[limit];
  if (allowed !== null && used + 1 > allowed) {
    return { reason: 'plan_limit', limit, allowed, used };
  }
  return null;
}

// ── What DINOLABS edits in /support ──────────────────────────────────────────

const code = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{1,31}$/);
const limit = z.int().min(0).max(100_000).nullable();

export const planInputSchema = z.object({
  code,
  name: z.string().trim().min(1).max(64),
  limits: z.object({ devices: limit, users: limit, locations: limit }),
  features: z.array(z.enum(PLAN_FEATURES)).max(PLAN_FEATURES.length),
  isActive: z.boolean().default(true),
  sortOrder: z.int().min(0).max(999).default(0),
});

export const addonInputSchema = z.object({
  code,
  name: z.string().trim().min(1).max(64),
  adds: z.object({
    devices: z.int().min(0).max(1000).optional(),
    users: z.int().min(0).max(1000).optional(),
    locations: z.int().min(0).max(100).optional(),
  }),
  features: z.array(z.enum(PLAN_FEATURES)).max(PLAN_FEATURES.length),
  isActive: z.boolean().default(true),
});

/** A monthly price of a plan or an add-on in one country and currency (minor units). */
export const planPriceInputSchema = z.object({
  itemType: z.enum(['plan', 'addon']),
  itemCode: code,
  country: z
    .string()
    .trim()
    .regex(/^[A-Z]{2}$/),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/),
  amountMinor: z.int().min(0).max(100_000_000),
});

export const subscriptionInputSchema = z.object({
  planCode: code,
  status: z.enum(SUBSCRIPTION_STATUSES),
  addons: z
    .array(z.object({ code, quantity: z.int().min(0).max(1000) }))
    .max(20)
    .refine((list) => new Set(list.map((a) => a.code)).size === list.length, 'One line per add-on'),
  note: z.string().trim().max(500).nullable().default(null),
});

/**
 * The starting catalog (DEC-045): an example to edit in /support, not a price list. Existing
 * organizations start on Pro, so nothing changes for them.
 */
export const DEFAULT_PLANS: readonly PlanDefinition[] = [
  {
    code: 'cafe',
    name: 'Café',
    limits: { devices: 2, users: 5, locations: 1 },
    features: [],
  },
  {
    code: 'restaurant',
    name: 'Restaurant',
    limits: { devices: 8, users: 25, locations: 1 },
    features: ['kds', 'handhelds', 'phones', 'table_ownership'],
  },
  {
    code: 'pro',
    name: 'Pro',
    limits: { devices: null, users: null, locations: null },
    features: [...PLAN_FEATURES],
  },
];

export const DEFAULT_ADDONS: readonly AddonDefinition[] = [
  { code: 'extra_device', name: 'Extra device', adds: { devices: 1 }, features: [] },
  { code: 'extra_user', name: 'Extra user', adds: { users: 1 }, features: [] },
  {
    code: 'extra_location',
    name: 'Extra location',
    adds: { locations: 1 },
    features: ['multi_location'],
  },
  { code: 'kitchen_display', name: 'Kitchen displays', adds: {}, features: ['kds'] },
  { code: 'api_access', name: 'API access', adds: {}, features: ['api'] },
];
