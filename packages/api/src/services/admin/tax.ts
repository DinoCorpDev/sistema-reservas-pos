import {
  CONSUMPTION_TYPES,
  type ConsumptionType,
  type CreateTaxRateInput,
  type CreateTaxRuleInput,
  type IsoDate,
  newId,
  resolveTaxRate,
  TAX_CATEGORY_KEYS,
  type TaxCategoryKey,
  TaxError,
  type TaxRateCode,
  type TaxRateRecord,
  type TaxRuleRecord,
  type UpdateTaxCategoryInput,
} from '@pos/core';
import {
  type Database,
  inOrg,
  notDeleted,
  runCommand,
  schema as s,
  type TenantContext,
} from '@pos/db';
import { and, eq } from 'drizzle-orm';
import { type Actor, assertPermission } from '../../actor';
import { ApiError, notFound } from '../../errors';
import type { ServiceDeps } from '../shared';
import { actorTimeZone, commandContext, localDate } from './common';

/**
 * MWST administration (RF-B12, RF-B13, RN-02, RN-03). Rates and rules are DATA with validity
 * periods; changing them never touches past sales, whose rate is frozen on the line (RN-04).
 */

type TaxCategoryRow = typeof s.taxCategories.$inferSelect;
type TaxRateRow = typeof s.taxRates.$inferSelect;
type TaxRuleRow = typeof s.taxRules.$inferSelect;

export interface TaxCategoryDto {
  id: string;
  key: string;
  name: string;
}

export interface TaxRateDto {
  id: string;
  code: string;
  rateBp: number;
  validFrom: string;
  validTo: string | null;
}

export interface TaxRuleDto {
  id: string;
  taxCategoryId: string;
  taxCategoryKey: string;
  consumptionType: string;
  rateCode: string;
  validFrom: string;
  validTo: string | null;
}

/** Rate in force for a category and consumption type, or why it cannot be resolved. */
export type TaxMatrixEntry =
  | { taxCategoryKey: string; consumptionType: string; rateCode: string; rateBp: number }
  | { taxCategoryKey: string; consumptionType: string; error: string; message: string };

export interface TaxOverviewDto {
  /** Date the matrix was resolved for (today at the location unless asked otherwise). */
  date: string;
  categories: TaxCategoryDto[];
  rates: TaxRateDto[];
  rules: TaxRuleDto[];
  matrix: TaxMatrixEntry[];
}

const toCategoryDto = (row: TaxCategoryRow): TaxCategoryDto => ({
  id: row.id,
  key: row.key,
  name: row.name,
});

const toRateDto = (row: TaxRateRow): TaxRateDto => ({
  id: row.id,
  code: row.code,
  rateBp: row.rateBp,
  validFrom: row.validFrom,
  validTo: row.validTo,
});

const toRuleDto = (row: TaxRuleRow, keyOf: ReadonlyMap<string, string>): TaxRuleDto => ({
  id: row.id,
  taxCategoryId: row.taxCategoryId,
  taxCategoryKey: keyOf.get(row.taxCategoryId) ?? '',
  consumptionType: row.consumptionType,
  rateCode: row.rateCode,
  validFrom: row.validFrom,
  validTo: row.validTo,
});

const categoryOrder = (key: string) => {
  const index = (TAX_CATEGORY_KEYS as readonly string[]).indexOf(key);
  return index === -1 ? TAX_CATEGORY_KEYS.length : index;
};
const consumptionOrder = (type: string) => (CONSUMPTION_TYPES as readonly string[]).indexOf(type);

// ── Validity periods ────────────────────────────────────────────────────────

interface Period {
  validFrom: IsoDate;
  validTo: IsoDate | null;
}

const END_OF_TIME = '9999-12-31';

/** Inclusive periods overlap when each one starts before the other ends. */
export const periodsOverlap = (a: Period, b: Period) =>
  a.validFrom <= (b.validTo ?? END_OF_TIME) && b.validFrom <= (a.validTo ?? END_OF_TIME);

export function dayBefore(date: IsoDate): IsoDate {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}

/**
 * Plans the insertion of a new period among the existing ones of the same key: with
 * `closePrevious`, the open period that started earlier ends the day before; any remaining
 * overlap is a 409 (two rates or rules in force on the same day would be ambiguous, RN-02).
 */
function planPeriod<T extends Period & { id: string }>(
  existing: readonly T[],
  input: Period & { closePrevious: boolean },
  what: string,
): { close: { row: T; validTo: IsoDate } | null } {
  let close: { row: T; validTo: IsoDate } | null = null;
  if (input.closePrevious) {
    const open = existing.find((row) => row.validTo === null);
    if (open && open.validFrom < input.validFrom) {
      close = { row: open, validTo: dayBefore(input.validFrom) };
    }
  }
  const conflict = existing
    .map((row) => (row.id === close?.row.id ? { ...row, validTo: close.validTo } : row))
    .find((row) => periodsOverlap(row, input));
  if (conflict) {
    throw new ApiError('CONFLICT', `The validity period overlaps another ${what}`, {
      conflictingId: conflict.id,
      validFrom: conflict.validFrom,
      validTo: conflict.validTo,
    });
  }
  return { close };
}

// ── Reads ───────────────────────────────────────────────────────────────────

export interface TaxData {
  categories: TaxCategoryRow[];
  rates: TaxRateRow[];
  rules: TaxRuleRow[];
  rateRecords: TaxRateRecord[];
  ruleRecords: TaxRuleRecord[];
}

/** The organization's MWST data, plus the records `resolveTaxRate` works with. */
export async function loadTaxData(db: Database, ctx: TenantContext): Promise<TaxData> {
  const [categories, rates, rules] = await Promise.all([
    db
      .select()
      .from(s.taxCategories)
      .where(inOrg(s.taxCategories, ctx, notDeleted(s.taxCategories))),
    db
      .select()
      .from(s.taxRates)
      .where(inOrg(s.taxRates, ctx, notDeleted(s.taxRates))),
    db
      .select()
      .from(s.taxRules)
      .where(inOrg(s.taxRules, ctx, notDeleted(s.taxRules))),
  ]);
  categories.sort(
    (a, b) => categoryOrder(a.key) - categoryOrder(b.key) || a.key.localeCompare(b.key),
  );
  rates.sort((a, b) => a.code.localeCompare(b.code) || a.validFrom.localeCompare(b.validFrom));

  const keyOf = new Map(categories.map((c) => [c.id, c.key]));
  const liveRules = rules.filter((rule) => keyOf.has(rule.taxCategoryId));
  liveRules.sort(
    (a, b) =>
      categoryOrder(keyOf.get(a.taxCategoryId)!) - categoryOrder(keyOf.get(b.taxCategoryId)!) ||
      consumptionOrder(a.consumptionType) - consumptionOrder(b.consumptionType) ||
      a.validFrom.localeCompare(b.validFrom),
  );

  return {
    categories,
    rates,
    rules: liveRules,
    rateRecords: rates.map((rate) => ({
      code: rate.code as TaxRateCode,
      rateBp: rate.rateBp,
      validFrom: rate.validFrom,
      validTo: rate.validTo,
    })),
    ruleRecords: liveRules.map((rule) => ({
      taxCategoryKey: keyOf.get(rule.taxCategoryId) as TaxCategoryKey,
      consumptionType: rule.consumptionType as ConsumptionType,
      rateCode: rule.rateCode as TaxRateCode,
      validFrom: rule.validFrom,
      validTo: rule.validTo,
    })),
  };
}

/** Resolves one category and consumption type on a date; never throws. */
export function resolveEntry(
  data: Pick<TaxData, 'rateRecords' | 'ruleRecords'>,
  taxCategoryKey: string,
  consumptionType: ConsumptionType,
  date: IsoDate,
): TaxMatrixEntry {
  try {
    const resolved = resolveTaxRate({
      taxCategoryKey: taxCategoryKey as TaxCategoryKey,
      consumptionType,
      saleDate: date,
      rules: data.ruleRecords,
      rates: data.rateRecords,
    });
    return {
      taxCategoryKey,
      consumptionType,
      rateCode: resolved.rateCode,
      rateBp: resolved.rateBp,
    };
  } catch (error) {
    if (!(error instanceof TaxError)) throw error;
    return { taxCategoryKey, consumptionType, error: error.code, message: error.message };
  }
}

/** True when the category has a rule and a rate in force on `date` for every consumption type. */
export const resolvesForAllConsumptionTypes = (
  data: Pick<TaxData, 'rateRecords' | 'ruleRecords'>,
  taxCategoryKey: string,
  date: IsoDate,
) => CONSUMPTION_TYPES.every((type) => 'rateBp' in resolveEntry(data, taxCategoryKey, type, date));

/**
 * Categories, rates and rules of the organization, and the matrix category × consumption type
 * resolved on `date` (default: today in the caller's location time zone).
 */
export async function getTaxOverview(
  deps: ServiceDeps,
  actor: Actor,
  query: { date?: IsoDate } = {},
): Promise<TaxOverviewDto> {
  const date = query.date ?? localDate(await actorTimeZone(deps, actor));
  const data = await loadTaxData(deps.db, actor);
  const keyOf = new Map(data.categories.map((c) => [c.id, c.key]));
  return {
    date,
    categories: data.categories.map(toCategoryDto),
    rates: data.rates.map(toRateDto),
    rules: data.rules.map((rule) => toRuleDto(rule, keyOf)),
    matrix: data.categories.flatMap((category) =>
      CONSUMPTION_TYPES.map((type) => resolveEntry(data, category.key, type, date)),
    ),
  };
}

// ── Commands ────────────────────────────────────────────────────────────────

async function loadCategory(db: Database, actor: Actor, id: string) {
  const [row] = await db
    .select()
    .from(s.taxCategories)
    .where(inOrg(s.taxCategories, actor, eq(s.taxCategories.id, id), notDeleted(s.taxCategories)));
  if (!row) throw notFound('Tax category');
  return row;
}

export async function renameTaxCategory(
  deps: ServiceDeps,
  actor: Actor,
  id: string,
  input: UpdateTaxCategoryInput,
): Promise<TaxCategoryDto> {
  assertPermission(actor, 'tax.manage');
  const current = await loadCategory(deps.db, actor, id);
  if (current.name === input.name) return toCategoryDto(current);
  return runCommand(deps.db, commandContext(actor), async (tx, recorder) => {
    await tx
      .update(s.taxCategories)
      .set({ name: input.name })
      .where(inOrg(s.taxCategories, actor, eq(s.taxCategories.id, id)));
    recorder.audit({
      action: 'tax.category_renamed',
      entityType: 'tax_category',
      entityId: id,
      before: { name: current.name },
      after: { name: input.name },
      locationId: null,
    });
    return toCategoryDto({ ...current, name: input.name });
  });
}

/**
 * New rate for a code from `validFrom` (RF-B13). Sales keep the rate frozen on their lines
 * (RN-04); the new rate applies to sales on or after its start date.
 */
export async function createTaxRate(
  deps: ServiceDeps,
  actor: Actor,
  input: CreateTaxRateInput,
): Promise<TaxRateDto> {
  assertPermission(actor, 'tax.manage');
  return runCommand(deps.db, commandContext(actor), async (tx, recorder) => {
    const existing = await tx
      .select()
      .from(s.taxRates)
      .where(inOrg(s.taxRates, actor, eq(s.taxRates.code, input.code), notDeleted(s.taxRates)))
      .for('update');
    const { close } = planPeriod(existing, input, `${input.code} rate`);

    if (close) {
      await tx
        .update(s.taxRates)
        .set({ validTo: close.validTo })
        .where(inOrg(s.taxRates, actor, eq(s.taxRates.id, close.row.id)));
      recorder.audit({
        action: 'tax.rule_changed',
        entityType: 'tax_rate',
        entityId: close.row.id,
        before: { validTo: null },
        after: { validTo: close.validTo },
        locationId: null,
      });
    }

    const row: TaxRateRow = {
      id: newId(),
      organizationId: actor.organizationId,
      code: input.code,
      rateBp: input.rateBp,
      validFrom: input.validFrom,
      validTo: input.validTo,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };
    await tx.insert(s.taxRates).values({
      id: row.id,
      organizationId: row.organizationId,
      code: row.code,
      rateBp: row.rateBp,
      validFrom: row.validFrom,
      validTo: row.validTo,
    });
    const dto = toRateDto(row);
    recorder.audit({
      action: 'tax.rule_changed',
      entityType: 'tax_rate',
      entityId: row.id,
      after: { code: dto.code, rateBp: dto.rateBp, validFrom: dto.validFrom, validTo: dto.validTo },
      locationId: null,
    });
    recorder.event({
      type: 'tax.rule_changed',
      aggregateType: 'tax_rate',
      aggregateId: row.id,
      payload: {
        kind: 'rate',
        rate: dto,
        closed: close ? { id: close.row.id, validTo: close.validTo } : null,
      },
      locationId: null,
    });
    return dto;
  });
}

/** New rule category + consumption type → rate code from `validFrom` (RN-03, RF-B13). */
export async function createTaxRule(
  deps: ServiceDeps,
  actor: Actor,
  input: CreateTaxRuleInput,
): Promise<TaxRuleDto> {
  assertPermission(actor, 'tax.manage');
  const category = await loadCategory(deps.db, actor, input.taxCategoryId);
  return runCommand(deps.db, commandContext(actor), async (tx, recorder) => {
    const existing = await tx
      .select()
      .from(s.taxRules)
      .where(
        inOrg(
          s.taxRules,
          actor,
          and(
            eq(s.taxRules.taxCategoryId, category.id),
            eq(s.taxRules.consumptionType, input.consumptionType),
          ),
          notDeleted(s.taxRules),
        ),
      )
      .for('update');
    const { close } = planPeriod(existing, input, `${category.key}/${input.consumptionType} rule`);

    if (close) {
      await tx
        .update(s.taxRules)
        .set({ validTo: close.validTo })
        .where(inOrg(s.taxRules, actor, eq(s.taxRules.id, close.row.id)));
      recorder.audit({
        action: 'tax.rule_changed',
        entityType: 'tax_rule',
        entityId: close.row.id,
        before: { validTo: null },
        after: { validTo: close.validTo },
        locationId: null,
      });
    }

    const row: TaxRuleRow = {
      id: newId(),
      organizationId: actor.organizationId,
      taxCategoryId: category.id,
      consumptionType: input.consumptionType,
      rateCode: input.rateCode,
      validFrom: input.validFrom,
      validTo: input.validTo,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };
    await tx.insert(s.taxRules).values({
      id: row.id,
      organizationId: row.organizationId,
      taxCategoryId: row.taxCategoryId,
      consumptionType: row.consumptionType,
      rateCode: row.rateCode,
      validFrom: row.validFrom,
      validTo: row.validTo,
    });
    const dto = toRuleDto(row, new Map([[category.id, category.key]]));
    recorder.audit({
      action: 'tax.rule_changed',
      entityType: 'tax_rule',
      entityId: row.id,
      after: {
        taxCategoryKey: dto.taxCategoryKey,
        consumptionType: dto.consumptionType,
        rateCode: dto.rateCode,
        validFrom: dto.validFrom,
        validTo: dto.validTo,
      },
      locationId: null,
    });
    recorder.event({
      type: 'tax.rule_changed',
      aggregateType: 'tax_rule',
      aggregateId: row.id,
      payload: {
        kind: 'rule',
        rule: dto,
        closed: close ? { id: close.row.id, validTo: close.validTo } : null,
      },
      locationId: null,
    });
    return dto;
  });
}
