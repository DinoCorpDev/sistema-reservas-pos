import type { Channel } from '../shared/channels';
import type { ContentLanguage } from '../shared/languages';
import type { Rappen } from '../shared/money';
import type { IsoDate } from '../tax/calculation';
import { ORIGIN_KINDS, type OriginKind } from './constants';

// ── Price (RF-B01, RF-B04) ──────────────────────────────────────────────────

export interface ChannelPriceRecord {
  channel: Channel;
  locationId: string | null;
  variantId: string | null;
  priceRappen: Rappen;
}

/**
 * Gross price (MWST included) of a product for a channel at a location:
 * 1. a channel price for this variant (or the product without variant), location-specific first;
 * 2. otherwise the variant price;
 * 3. otherwise the location's own price, then the catalog price.
 */
export function resolvePrice(input: {
  basePriceRappen: Rappen;
  locationPriceRappen?: Rappen | null;
  variant?: { id: string; priceRappen: Rappen } | null;
  channelPrices: readonly ChannelPriceRecord[];
  channel: Channel;
  locationId: string;
}): Rappen {
  const variantId = input.variant?.id ?? null;
  const candidates = input.channelPrices.filter(
    (cp) =>
      cp.channel === input.channel &&
      (cp.variantId ?? null) === variantId &&
      (cp.locationId === null || cp.locationId === input.locationId),
  );
  const channelPrice =
    candidates.find((cp) => cp.locationId === input.locationId) ??
    candidates.find((cp) => cp.locationId === null);
  if (channelPrice) return channelPrice.priceRappen;
  if (input.variant) return input.variant.priceRappen;
  return input.locationPriceRappen ?? input.basePriceRappen;
}

// ── Availability (RN-17, RF-B08, RF-B09) ────────────────────────────────────

export interface AvailabilityRuleRecord {
  locationId: string | null;
  productId: string | null;
  categoryId: string | null;
  channel: Channel | null;
  /** Bitmask: Monday = 1, Tuesday = 2 … Sunday = 64. */
  daysOfWeek: number;
  /** `HH:MM[:SS]`; null = all day. A window with start > end crosses midnight. */
  startTime: string | null;
  endTime: string | null;
  validFrom: IsoDate | null;
  validTo: IsoDate | null;
}

/** Local wall-clock moment at the location, plus the absolute instant for sold-out checks. */
export interface LocalMoment {
  now: Date;
  date: IsoDate;
  /** `HH:MM:SS` in the location's time zone. */
  time: string;
  /** ISO weekday: Monday = 1 … Sunday = 7. */
  isoWeekday: number;
}

export type UnavailableReason =
  | 'inactive'
  | 'inactive_at_location'
  | 'sold_out'
  | 'not_available_now'
  | 'not_available_on_channel';

export type Orderability = { orderable: true } | { orderable: false; reason: UnavailableReason };

const normalizeTime = (value: string) => (value.length === 5 ? `${value}:00` : value);

function inTimeWindow(rule: AvailabilityRuleRecord, time: string): boolean {
  if (rule.startTime === null || rule.endTime === null) return true;
  const start = normalizeTime(rule.startTime);
  const end = normalizeTime(rule.endTime);
  return start <= end ? start <= time && time < end : time >= start || time < end;
}

function matchesMoment(rule: AvailabilityRuleRecord, at: LocalMoment): boolean {
  const dayBit = 1 << (at.isoWeekday - 1);
  return (
    (rule.daysOfWeek & dayBit) !== 0 &&
    inTimeWindow(rule, at.time) &&
    (rule.validFrom === null || rule.validFrom <= at.date) &&
    (rule.validTo === null || at.date <= rule.validTo)
  );
}

/** A product is sold out when marked "86" and its automatic return time has not come yet. */
export function isSoldOut(
  setting: { soldOutAt: Date | null; soldOutUntil: Date | null } | null | undefined,
  now: Date,
): boolean {
  if (!setting?.soldOutAt) return false;
  return setting.soldOutUntil === null || now < setting.soldOutUntil;
}

/**
 * RN-17: a product can only be ordered if it is active (globally and at the location), not sold
 * out, and available for the channel at this moment. If the product or its category has
 * availability rules, at least one must match; without rules it is always available.
 * The Core validates this on every order line; the screen is not enough.
 */
export function checkOrderable(input: {
  product: { id: string; categoryId: string; isActive: boolean };
  locationSetting?: {
    isActive: boolean;
    soldOutAt: Date | null;
    soldOutUntil: Date | null;
  } | null;
  rules: readonly AvailabilityRuleRecord[];
  channel: Channel;
  locationId: string;
  at: LocalMoment;
}): Orderability {
  const { product, locationSetting, channel, locationId, at } = input;
  if (!product.isActive) return { orderable: false, reason: 'inactive' };
  if (locationSetting && !locationSetting.isActive) {
    return { orderable: false, reason: 'inactive_at_location' };
  }
  if (isSoldOut(locationSetting, at.now)) return { orderable: false, reason: 'sold_out' };

  const relevant = input.rules.filter(
    (rule) =>
      (rule.productId === product.id || rule.categoryId === product.categoryId) &&
      (rule.locationId === null || rule.locationId === locationId),
  );
  if (relevant.length === 0) return { orderable: true };

  const nowMatching = relevant.filter((rule) => matchesMoment(rule, at));
  if (nowMatching.length === 0) return { orderable: false, reason: 'not_available_now' };
  if (!nowMatching.some((rule) => rule.channel === null || rule.channel === channel)) {
    return { orderable: false, reason: 'not_available_on_channel' };
  }
  return { orderable: true };
}

// ── Publication to QR and web (RN-18) ───────────────────────────────────────

export type PublicationIssue = 'allergens_missing' | 'origin_missing';

/**
 * RN-18: a product is not published to the QR menu or the web while its allergens are not
 * confirmed, or, if it contains meat, poultry or fish, while its origin is missing.
 */
export function checkPublishable(product: {
  allergensComplete: boolean;
  requiresOrigin: boolean;
  origins: readonly { kind: string; country: string }[];
}): { publishable: boolean; issues: PublicationIssue[] } {
  const issues: PublicationIssue[] = [];
  if (!product.allergensComplete) issues.push('allergens_missing');
  const declared = product.origins.filter(
    (o) =>
      (ORIGIN_KINDS as readonly string[]).includes(o.kind as OriginKind) &&
      /^[A-Z]{2}$/.test(o.country),
  );
  if (product.requiresOrigin && declared.length === 0) issues.push('origin_missing');
  return { publishable: issues.length === 0, issues };
}

// ── Modifiers (RF-B02) ──────────────────────────────────────────────────────

export interface ModifierGroupRule {
  id: string;
  minSelect: number;
  maxSelect: number;
  modifierIds: readonly string[];
}

export type ModifierIssue =
  | { code: 'below_min'; groupId: string; min: number; selected: number }
  | { code: 'above_max'; groupId: string; max: number; selected: number }
  | { code: 'unknown_modifier'; modifierId: string };

/** Checks the selected modifiers against the product's groups (required groups, min and max). */
export function validateModifierSelection(
  groups: readonly ModifierGroupRule[],
  selected: readonly { modifierId: string; quantity?: number }[],
): ModifierIssue[] {
  const issues: ModifierIssue[] = [];
  const groupOf = new Map<string, string>();
  for (const group of groups) for (const id of group.modifierIds) groupOf.set(id, group.id);

  const counts = new Map<string, number>();
  for (const choice of selected) {
    const groupId = groupOf.get(choice.modifierId);
    if (!groupId) {
      issues.push({ code: 'unknown_modifier', modifierId: choice.modifierId });
      continue;
    }
    counts.set(groupId, (counts.get(groupId) ?? 0) + (choice.quantity ?? 1));
  }
  for (const group of groups) {
    const count = counts.get(group.id) ?? 0;
    if (count < group.minSelect) {
      issues.push({ code: 'below_min', groupId: group.id, min: group.minSelect, selected: count });
    }
    if (count > group.maxSelect) {
      issues.push({ code: 'above_max', groupId: group.id, max: group.maxSelect, selected: count });
    }
  }
  return issues;
}

// ── Translations (RF-B07) ───────────────────────────────────────────────────

/**
 * Text in the requested language; if missing, in the location's language; if still missing, the
 * catalog text (default language of the organization).
 */
export function translate(
  texts: Partial<Record<ContentLanguage, string | null | undefined>>,
  fallback: string,
  language: ContentLanguage,
  locationLanguage: ContentLanguage,
): string {
  const pick = (lang: ContentLanguage) => {
    const value = texts[lang];
    return value && value.trim() !== '' ? value : null;
  };
  return pick(language) ?? pick(locationLanguage) ?? fallback;
}
