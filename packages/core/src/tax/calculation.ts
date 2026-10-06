import type { ConsumptionType } from '../shared/channels';
import { type Rappen, rappen, subtractRappen } from '../shared/money';
import type { BasisPoints, TaxCategoryKey, TaxRateCode } from './constants';

/**
 * Swiss MWST calculation (RN-01…RN-04).
 *
 * Prices include MWST: the tax is always EXTRACTED from the gross amount, never added on top.
 * Rates and rules are data with validity dates passed in by the caller; this module holds no
 * percentages. All arithmetic is integer (BigInt where products can grow).
 */

/** ISO calendar date `YYYY-MM-DD`, in the location's time zone. */
export type IsoDate = string;

export interface TaxRateRecord {
  code: TaxRateCode;
  rateBp: BasisPoints;
  validFrom: IsoDate;
  validTo: IsoDate | null;
}

export interface TaxRuleRecord {
  taxCategoryKey: TaxCategoryKey;
  consumptionType: ConsumptionType;
  rateCode: TaxRateCode;
  validFrom: IsoDate;
  validTo: IsoDate | null;
}

export interface ResolvedTaxRate {
  taxCategoryKey: TaxCategoryKey;
  rateCode: TaxRateCode;
  rateBp: BasisPoints;
}

export type TaxErrorCode = 'NO_RULE' | 'AMBIGUOUS_RULE' | 'NO_RATE' | 'AMBIGUOUS_RATE' | 'INVALID';

export class TaxError extends Error {
  override readonly name = 'TaxError';
  constructor(
    readonly code: TaxErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function assertIsoDate(value: string, label: string): void {
  if (!ISO_DATE.test(value)) {
    throw new TaxError('INVALID', `${label} must be an ISO date (YYYY-MM-DD), got "${value}"`);
  }
}

/** Inclusive validity check; ISO dates compare correctly as strings. */
export function isValidOn(record: { validFrom: IsoDate; validTo: IsoDate | null }, date: IsoDate) {
  return record.validFrom <= date && (record.validTo === null || date <= record.validTo);
}

/**
 * Picks the rule and the rate in force on the sale date (RN-02, RN-03): tax category +
 * consumption type → rate code → percentage. Missing or overlapping data is an explicit error,
 * never a silent default.
 */
export function resolveTaxRate(input: {
  taxCategoryKey: TaxCategoryKey;
  consumptionType: ConsumptionType;
  saleDate: IsoDate;
  rules: readonly TaxRuleRecord[];
  rates: readonly TaxRateRecord[];
}): ResolvedTaxRate {
  const { taxCategoryKey, consumptionType, saleDate } = input;
  assertIsoDate(saleDate, 'saleDate');

  const rules = input.rules.filter(
    (rule) =>
      rule.taxCategoryKey === taxCategoryKey &&
      rule.consumptionType === consumptionType &&
      isValidOn(rule, saleDate),
  );
  if (rules.length === 0) {
    throw new TaxError(
      'NO_RULE',
      `No tax rule for ${taxCategoryKey}/${consumptionType} on ${saleDate}`,
    );
  }
  if (rules.length > 1) {
    throw new TaxError(
      'AMBIGUOUS_RULE',
      `${rules.length} overlapping tax rules for ${taxCategoryKey}/${consumptionType} on ${saleDate}`,
    );
  }
  const rateCode = rules[0]!.rateCode;

  const rates = input.rates.filter((rate) => rate.code === rateCode && isValidOn(rate, saleDate));
  if (rates.length === 0) {
    throw new TaxError('NO_RATE', `No ${rateCode} tax rate valid on ${saleDate}`);
  }
  if (rates.length > 1) {
    throw new TaxError('AMBIGUOUS_RATE', `${rates.length} overlapping ${rateCode} rates on ${saleDate}`);
  }
  const rateBp = rates[0]!.rateBp;
  assertRateBp(rateBp);
  return { taxCategoryKey, rateCode, rateBp };
}

function assertRateBp(rateBp: number): void {
  if (!Number.isInteger(rateBp) || rateBp < 0 || rateBp > 10000) {
    throw new TaxError('INVALID', `rateBp must be an integer between 0 and 10000, got ${rateBp}`);
  }
}

/**
 * Tax contained in a tax-inclusive amount (RN-01):
 * `tax = gross × rate / (100 % + rate)`, rounded half up to the rappen, symmetric for negatives.
 * Rounding happens per line and receipts add the line amounts per rate (DEC-016).
 */
export function extractTax(gross: Rappen, rateBp: BasisPoints): Rappen {
  assertRateBp(rateBp);
  const magnitude = BigInt(Math.abs(gross));
  const numerator = magnitude * BigInt(rateBp);
  const denominator = BigInt(10000 + rateBp);
  const rounded = (2n * numerator + denominator) / (2n * denominator);
  const value = Number(rounded);
  return rappen(gross < 0 ? -value : value);
}

export interface LinePricingInput {
  /** Gross unit price of the product or variant, MWST included. */
  unitPriceRappen: Rappen;
  /** Sum of the modifier surcharges per unit, MWST included. */
  modifiersRappen: Rappen;
  quantity: number;
  /** Discount on the whole line (already allocated if it comes from an order discount). */
  discountRappen: Rappen;
  rate: ResolvedTaxRate;
}

/** A priced line with price, rate and tax frozen as they will be stored (RN-04). */
export interface PricedLine {
  unitPriceRappen: Rappen;
  modifiersRappen: Rappen;
  quantity: number;
  grossBeforeDiscountRappen: Rappen;
  discountRappen: Rappen;
  lineTotalRappen: Rappen;
  taxCategoryKey: TaxCategoryKey;
  taxRateCode: TaxRateCode;
  taxRateBp: BasisPoints;
  taxRappen: Rappen;
  netRappen: Rappen;
}

export function priceLine(input: LinePricingInput): PricedLine {
  const { unitPriceRappen, modifiersRappen, quantity, discountRappen, rate } = input;
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new TaxError('INVALID', `quantity must be a positive integer, got ${quantity}`);
  }
  if (unitPriceRappen < 0 || modifiersRappen < 0) {
    throw new TaxError('INVALID', 'prices cannot be negative');
  }
  const grossBeforeDiscount = rappen((unitPriceRappen + modifiersRappen) * quantity);
  if (discountRappen < 0 || discountRappen > grossBeforeDiscount) {
    throw new TaxError(
      'INVALID',
      `discount must be between 0 and the line amount (${grossBeforeDiscount}), got ${discountRappen}`,
    );
  }
  const lineTotal = subtractRappen(grossBeforeDiscount, discountRappen);
  const tax = extractTax(lineTotal, rate.rateBp);
  return {
    unitPriceRappen,
    modifiersRappen,
    quantity,
    grossBeforeDiscountRappen: grossBeforeDiscount,
    discountRappen,
    lineTotalRappen: lineTotal,
    taxCategoryKey: rate.taxCategoryKey,
    taxRateCode: rate.rateCode,
    taxRateBp: rate.rateBp,
    taxRappen: tax,
    netRappen: subtractRappen(lineTotal, tax),
  };
}

export interface TaxSummaryLine {
  rateCode: TaxRateCode;
  rateBp: BasisPoints;
  grossRappen: Rappen;
  taxRappen: Rappen;
  netRappen: Rappen;
}

/**
 * Totals per rate for the receipt and the reports (RF-D20, RF-F02): adds the frozen line
 * amounts, so the receipt always matches the stored lines. Sorted by rate, highest first.
 */
export function summarizeByRate(
  lines: readonly { taxRateCode: TaxRateCode; taxRateBp: BasisPoints; lineTotalRappen: Rappen; taxRappen: Rappen }[],
): TaxSummaryLine[] {
  const byKey = new Map<string, TaxSummaryLine>();
  for (const line of lines) {
    const key = `${line.taxRateCode}:${line.taxRateBp}`;
    const current = byKey.get(key) ?? {
      rateCode: line.taxRateCode,
      rateBp: line.taxRateBp,
      grossRappen: rappen(0),
      taxRappen: rappen(0),
      netRappen: rappen(0),
    };
    current.grossRappen = rappen(current.grossRappen + line.lineTotalRappen);
    current.taxRappen = rappen(current.taxRappen + line.taxRappen);
    current.netRappen = subtractRappen(current.grossRappen, current.taxRappen);
    byKey.set(key, current);
  }
  return [...byKey.values()].sort((a, b) => b.rateBp - a.rateBp || a.rateCode.localeCompare(b.rateCode));
}

/**
 * Splits `total` proportionally to integer `weights` with the largest-remainder method, so the
 * parts always add up exactly to the total (order discounts, equal splits). Ties go to the
 * earliest index. All-zero weights split evenly.
 */
export function allocate(total: Rappen, weights: readonly number[]): Rappen[] {
  if (weights.length === 0) {
    throw new TaxError('INVALID', 'allocate needs at least one weight');
  }
  if (weights.some((w) => !Number.isSafeInteger(w) || w < 0)) {
    throw new TaxError('INVALID', 'weights must be non-negative safe integers');
  }
  const effective = weights.every((w) => w === 0) ? weights.map(() => 1) : weights;
  const sign = total < 0 ? -1n : 1n;
  const magnitude = BigInt(Math.abs(total));
  const weightSum = effective.reduce((sum, w) => sum + BigInt(w), 0n);

  const shares = effective.map((w, index) => {
    const exact = magnitude * BigInt(w);
    return { index, floor: exact / weightSum, remainder: exact % weightSum };
  });
  let leftover = magnitude - shares.reduce((sum, share) => sum + share.floor, 0n);
  const byRemainder = [...shares].sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
  );
  for (const share of byRemainder) {
    if (leftover === 0n) break;
    share.floor += 1n;
    leftover -= 1n;
  }
  return shares.map((share) => rappen(Number(share.floor * sign)));
}

/** Equal split of an amount into `parts` (RF-C12); the first parts carry the extra rappen. */
export function splitEvenly(total: Rappen, parts: number): Rappen[] {
  if (!Number.isInteger(parts) || parts <= 0) {
    throw new TaxError('INVALID', `parts must be a positive integer, got ${parts}`);
  }
  return allocate(total, Array.from({ length: parts }, () => 1));
}
