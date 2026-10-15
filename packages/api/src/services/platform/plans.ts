import {
  type AddonDefinition,
  type addonInputSchema,
  countsAsDevice,
  type Entitlements,
  entitlementsOf,
  featureForDevice,
  type GrowthRefusal,
  PLAN_FEATURES,
  PLAN_LIMITS,
  type PlanDefinition,
  type PlanFeature,
  type planInputSchema,
  type PlanLimit,
  type PlanLimits,
  type planPriceInputSchema,
  refuseGrowth,
  type SubscriptionStatus,
  type subscriptionInputSchema,
} from '@pos/core';
import { type Database, runCommand, schema as s, type Transaction } from '@pos/db';
import { and, asc, count, eq, isNull, ne } from 'drizzle-orm';
import type { z } from 'zod';
import { type Actor, assertPermission } from '../../actor';
import { ApiError } from '../../errors';
import { assertActiveStaff } from '../admin/support';
import type { ServiceDeps } from '../shared';

/**
 * Plans, add-ons and subscriptions (DEC-045). The catalog and each organization's subscription
 * are edited by DINOLABS in /support; the use cases that add a device, a user or an API key ask
 * `assertGrowth` first. What is legal never asks: sales, receipts, the Z and exports work in
 * every plan and state. A practice organization (RF-F22) and one without a subscription (from
 * before plans) have no limits.
 */

type Db = Database | Transaction;

const asPlan = (row: typeof s.plans.$inferSelect): PlanDefinition => ({
  code: row.code,
  name: row.name,
  limits: limitsOf(row.limits),
  features: featuresOf(row.features),
});

const asAddon = (row: typeof s.planAddons.$inferSelect): AddonDefinition => {
  const adds = (row.adds ?? {}) as Partial<Record<PlanLimit, number>>;
  return {
    code: row.code,
    name: row.name,
    adds: Object.fromEntries(
      PLAN_LIMITS.flatMap((limit) =>
        typeof adds[limit] === 'number' ? [[limit, adds[limit]]] : [],
      ),
    ),
    features: featuresOf(row.features),
  };
};

function limitsOf(value: unknown): PlanLimits {
  const raw = (value ?? {}) as Record<string, unknown>;
  return Object.fromEntries(
    PLAN_LIMITS.map((limit) => [limit, typeof raw[limit] === 'number' ? raw[limit] : null]),
  ) as PlanLimits;
}

const featuresOf = (value: unknown): PlanFeature[] =>
  (Array.isArray(value) ? value : []).filter((f): f is PlanFeature =>
    (PLAN_FEATURES as readonly string[]).includes(f as string),
  );

const UNLIMITED: Entitlements = {
  plan: 'pro',
  status: 'active',
  limits: { devices: null, users: null, locations: null },
  features: new Set(PLAN_FEATURES),
};

export interface SubscriptionView {
  planCode: string;
  planName: string;
  status: SubscriptionStatus;
  statusSince: string | null;
  note: string | null;
  addons: { code: string; name: string; quantity: number }[];
}

/** The organization's entitlements and its subscription as stored (null: none, i.e. Pro). */
export async function entitlementsFor(
  db: Db,
  organizationId: string,
): Promise<{ entitlements: Entitlements; subscription: SubscriptionView | null }> {
  const [organization] = await db
    .select({ isTraining: s.organizations.isTraining })
    .from(s.organizations)
    .where(eq(s.organizations.id, organizationId));
  const [subscription] = await db
    .select()
    .from(s.subscriptions)
    .where(
      and(eq(s.subscriptions.organizationId, organizationId), isNull(s.subscriptions.deletedAt)),
    );
  if (!subscription) return { entitlements: UNLIMITED, subscription: null };
  const [planRow] = await db.select().from(s.plans).where(eq(s.plans.code, subscription.planCode));
  const bought = await db
    .select()
    .from(s.subscriptionAddons)
    .where(
      and(
        eq(s.subscriptionAddons.organizationId, organizationId),
        isNull(s.subscriptionAddons.deletedAt),
      ),
    );
  const addonRows = bought.length === 0 ? [] : await db.select().from(s.planAddons);
  const status = subscription.status as SubscriptionStatus;
  const view: SubscriptionView = {
    planCode: subscription.planCode,
    planName: planRow?.name ?? subscription.planCode,
    status,
    statusSince: subscription.statusSince.toISOString(),
    note: subscription.note,
    addons: bought
      .filter((line) => line.quantity > 0)
      .map((line) => ({
        code: line.addonCode,
        name: addonRows.find((a) => a.code === line.addonCode)?.name ?? line.addonCode,
        quantity: line.quantity,
      })),
  };
  // Practice data never counts against anything (RF-F22).
  if (organization?.isTraining || !planRow) {
    return { entitlements: { ...UNLIMITED, status }, subscription: view };
  }
  const entitlements = entitlementsOf(
    asPlan(planRow),
    bought.flatMap((line) => {
      const row = addonRows.find((a) => a.code === line.addonCode);
      return row ? [{ addon: asAddon(row), quantity: line.quantity }] : [];
    }),
    status,
  );
  return { entitlements, subscription: view };
}

/** What the organization uses now: devices (no hub), people, locations. */
export async function usageOf(db: Db, organizationId: string): Promise<Record<PlanLimit, number>> {
  const [[devices], [users], [locations]] = await Promise.all([
    db
      .select({ value: count() })
      .from(s.terminals)
      .where(
        and(
          eq(s.terminals.organizationId, organizationId),
          eq(s.terminals.isActive, true),
          ne(s.terminals.type, 'hub'),
          isNull(s.terminals.deletedAt),
        ),
      ),
    db
      .select({ value: count() })
      .from(s.users)
      .where(
        and(
          eq(s.users.organizationId, organizationId),
          eq(s.users.isActive, true),
          isNull(s.users.deletedAt),
        ),
      ),
    db
      .select({ value: count() })
      .from(s.locations)
      .where(and(eq(s.locations.organizationId, organizationId), isNull(s.locations.deletedAt))),
  ]);
  return {
    devices: Number(devices?.value ?? 0),
    users: Number(users?.value ?? 0),
    locations: Number(locations?.value ?? 0),
  };
}

const REFUSAL_MESSAGE: Record<GrowthRefusal['reason'], string> = {
  subscription_suspended: 'The subscription is suspended: nothing can be added',
  plan_feature: 'The plan does not include this module',
  plan_limit: 'The plan allows no more of these',
};

const refused = (refusal: GrowthRefusal, plan: string) =>
  new ApiError('CONFLICT', REFUSAL_MESSAGE[refusal.reason], { ...refusal, plan });

/**
 * Before adding a device (by its type), a person or a module such as the API: refuses with 409
 * when the plan does not allow it (`details.reason`: plan_limit, plan_feature or
 * subscription_suspended). The hub is not a device of the plan.
 */
export async function assertGrowth(
  db: Db,
  organizationId: string,
  what: { device?: string; limit?: PlanLimit; feature?: PlanFeature | null },
): Promise<void> {
  const { entitlements } = await entitlementsFor(db, organizationId);
  const feature = what.device ? featureForDevice(what.device) : (what.feature ?? null);
  const limit: PlanLimit | null = what.device
    ? countsAsDevice(what.device)
      ? 'devices'
      : null
    : (what.limit ?? null);
  if (entitlements.status === 'suspended') {
    throw refused({ reason: 'subscription_suspended' }, entitlements.plan);
  }
  if (feature && !entitlements.features.has(feature)) {
    throw refused({ reason: 'plan_feature', feature }, entitlements.plan);
  }
  if (limit === null || entitlements.limits[limit] === null) return;
  const refusal = refuseGrowth(entitlements, limit, (await usageOf(db, organizationId))[limit]);
  if (refusal) throw refused(refusal, entitlements.plan);
}

// ── The organization's own view: «Mi plan» ───────────────────────────────────

export interface MyPlanDto {
  subscription: SubscriptionView | null;
  limits: PlanLimits;
  features: PlanFeature[];
  usage: Record<PlanLimit, number>;
  /** Monthly prices in the location's country, when DINOLABS set them. */
  prices: {
    plan: { currency: string; amountMinor: number } | null;
    addons: { code: string; currency: string; amountMinor: number }[];
  };
  /** The plans that include what this one lacks (for the locks: «in the Restaurant plan»). */
  featurePlans: Partial<Record<PlanFeature, string>>;
}

export async function getMyPlan(deps: ServiceDeps, actor: Actor): Promise<MyPlanDto> {
  assertPermission(actor, 'location.manage');
  const { entitlements, subscription } = await entitlementsFor(deps.db, actor.organizationId);
  const [usage, plans, location] = await Promise.all([
    usageOf(deps.db, actor.organizationId),
    deps.db
      .select()
      .from(s.plans)
      .where(and(eq(s.plans.isActive, true), isNull(s.plans.deletedAt)))
      .orderBy(asc(s.plans.sortOrder)),
    actor.locationId
      ? deps.db
          .select({ country: s.locations.country })
          .from(s.locations)
          .where(eq(s.locations.id, actor.locationId))
      : Promise.resolve([]),
  ]);
  const country = location[0]?.country ?? 'CH';
  const prices = await deps.db
    .select()
    .from(s.planPrices)
    .where(and(eq(s.planPrices.country, country), isNull(s.planPrices.deletedAt)));
  const featurePlans: Partial<Record<PlanFeature, string>> = {};
  for (const feature of PLAN_FEATURES) {
    const plan = plans.find((row) => featuresOf(row.features).includes(feature));
    if (plan) featurePlans[feature] = plan.name;
  }
  const planCode = subscription?.planCode ?? 'pro';
  const priceOf = (type: string, code: string) =>
    prices.find((price) => price.itemType === type && price.itemCode === code);
  const planPrice = priceOf('plan', planCode);
  return {
    subscription,
    limits: entitlements.limits,
    features: [...entitlements.features],
    usage,
    prices: {
      plan: planPrice ? { currency: planPrice.currency, amountMinor: planPrice.amountMinor } : null,
      addons: (subscription?.addons ?? []).flatMap((addon) => {
        const price = priceOf('addon', addon.code);
        return price
          ? [{ code: addon.code, currency: price.currency, amountMinor: price.amountMinor }]
          : [];
      }),
    },
    featurePlans,
  };
}

// ── DINOLABS: the catalog and the subscriptions (/support) ─────────────────────

export interface PlanCatalogDto {
  plans: (PlanDefinition & { isActive: boolean; sortOrder: number })[];
  addons: (AddonDefinition & { isActive: boolean })[];
  prices: z.output<typeof planPriceInputSchema>[];
}

export async function getPlanCatalog(
  deps: ServiceDeps,
  staff: { staffId: string },
): Promise<PlanCatalogDto> {
  await assertActiveStaff(deps.db, staff.staffId);
  const [plans, addons, prices] = await Promise.all([
    deps.db.select().from(s.plans).where(isNull(s.plans.deletedAt)).orderBy(asc(s.plans.sortOrder)),
    deps.db
      .select()
      .from(s.planAddons)
      .where(isNull(s.planAddons.deletedAt))
      .orderBy(asc(s.planAddons.code)),
    deps.db
      .select()
      .from(s.planPrices)
      .where(isNull(s.planPrices.deletedAt))
      .orderBy(asc(s.planPrices.itemType), asc(s.planPrices.itemCode), asc(s.planPrices.country)),
  ]);
  return {
    plans: plans.map((row) => ({
      ...asPlan(row),
      isActive: row.isActive,
      sortOrder: row.sortOrder,
    })),
    addons: addons.map((row) => ({ ...asAddon(row), isActive: row.isActive })),
    prices: prices.map((row) => ({
      itemType: row.itemType as 'plan' | 'addon',
      itemCode: row.itemCode,
      country: row.country,
      currency: row.currency,
      amountMinor: row.amountMinor,
    })),
  };
}

export async function savePlan(
  deps: ServiceDeps,
  staff: { staffId: string },
  input: z.output<typeof planInputSchema>,
) {
  await assertActiveStaff(deps.db, staff.staffId);
  const values = {
    name: input.name,
    limits: input.limits,
    features: input.features,
    isActive: input.isActive,
    sortOrder: input.sortOrder,
  };
  await deps.db
    .insert(s.plans)
    .values({ code: input.code, ...values })
    .onDuplicateKeyUpdate({ set: { ...values, deletedAt: null } });
}

export async function saveAddon(
  deps: ServiceDeps,
  staff: { staffId: string },
  input: z.output<typeof addonInputSchema>,
) {
  await assertActiveStaff(deps.db, staff.staffId);
  const values = {
    name: input.name,
    adds: input.adds,
    features: input.features,
    isActive: input.isActive,
  };
  await deps.db
    .insert(s.planAddons)
    .values({ code: input.code, ...values })
    .onDuplicateKeyUpdate({ set: { ...values, deletedAt: null } });
}

/** Sets a monthly price; amount null removes it. */
export async function savePlanPrice(
  deps: ServiceDeps,
  staff: { staffId: string },
  input:
    | z.output<typeof planPriceInputSchema>
    | (Omit<z.output<typeof planPriceInputSchema>, 'amountMinor'> & { amountMinor: null }),
) {
  await assertActiveStaff(deps.db, staff.staffId);
  const key = and(
    eq(s.planPrices.itemType, input.itemType),
    eq(s.planPrices.itemCode, input.itemCode),
    eq(s.planPrices.country, input.country),
    eq(s.planPrices.currency, input.currency),
  );
  if (input.amountMinor === null) {
    await deps.db.update(s.planPrices).set({ deletedAt: new Date() }).where(key);
    return;
  }
  await deps.db
    .insert(s.planPrices)
    .values({ ...input, amountMinor: input.amountMinor })
    .onDuplicateKeyUpdate({ set: { amountMinor: input.amountMinor, deletedAt: null } });
}

export interface OrganizationPlanDto {
  subscription: SubscriptionView | null;
  limits: PlanLimits;
  usage: Record<PlanLimit, number>;
}

export async function getOrganizationPlan(
  deps: ServiceDeps,
  staff: { staffId: string },
  organizationId: string,
): Promise<OrganizationPlanDto> {
  await assertActiveStaff(deps.db, staff.staffId);
  const [{ entitlements, subscription }, usage] = await Promise.all([
    entitlementsFor(deps.db, organizationId),
    usageOf(deps.db, organizationId),
  ]);
  return { subscription, limits: entitlements.limits, usage };
}

/**
 * Sets an organization's plan, add-ons and state (manual billing, DEC-045). Audited in the
 * organization's log as DINOLABS support. Lowering a plan never removes what exists: it only
 * stops what would be added beyond it.
 */
export async function updateSubscription(
  deps: ServiceDeps,
  staff: { staffId: string },
  organizationId: string,
  input: z.output<typeof subscriptionInputSchema>,
) {
  await assertActiveStaff(deps.db, staff.staffId);
  const [plan] = await deps.db.select().from(s.plans).where(eq(s.plans.code, input.planCode));
  if (!plan) throw new ApiError('VALIDATION_FAILED', 'Unknown plan', { field: 'planCode' });
  const known = await deps.db.select({ code: s.planAddons.code }).from(s.planAddons);
  const unknown = input.addons.find((a) => !known.some((k) => k.code === a.code));
  if (unknown) throw new ApiError('VALIDATION_FAILED', 'Unknown add-on', { field: 'addons' });
  const before = (await entitlementsFor(deps.db, organizationId)).subscription;
  const now = new Date();
  await runCommand(
    deps.db,
    { organizationId, supportStaffId: staff.staffId, requestId: null },
    async (tx, recorder) => {
      await tx
        .insert(s.subscriptions)
        .values({
          organizationId,
          planCode: input.planCode,
          status: input.status,
          statusSince: now,
          note: input.note,
        })
        .onDuplicateKeyUpdate({
          set: {
            planCode: input.planCode,
            note: input.note,
            ...(before?.status === input.status ? {} : { status: input.status, statusSince: now }),
          },
        });
      for (const addon of input.addons) {
        await tx
          .insert(s.subscriptionAddons)
          .values({ organizationId, addonCode: addon.code, quantity: addon.quantity })
          .onDuplicateKeyUpdate({ set: { quantity: addon.quantity, deletedAt: null } });
      }
      const kept = new Set(input.addons.map((a) => a.code));
      for (const old of before?.addons ?? []) {
        if (kept.has(old.code)) continue;
        await tx
          .update(s.subscriptionAddons)
          .set({ quantity: 0 })
          .where(
            and(
              eq(s.subscriptionAddons.organizationId, organizationId),
              eq(s.subscriptionAddons.addonCode, old.code),
            ),
          );
      }
      recorder.audit({
        action: 'subscription.changed',
        entityType: 'organization',
        entityId: organizationId,
        before: before ? { ...before } : null,
        after: { planCode: input.planCode, status: input.status, addons: input.addons },
      });
    },
  );
  return getOrganizationPlan(deps, staff, organizationId);
}
