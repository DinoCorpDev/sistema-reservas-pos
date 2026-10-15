import type { Permission } from '../organization/permissions';

/**
 * The kind of establishment chosen when DINOLABS creates it (DEC-045): it proposes the plan, the
 * roles and how service works. Everything stays editable afterwards in the backoffice.
 */
export const BUSINESS_PROFILES = ['restaurant', 'cafe'] as const;
export type BusinessProfile = (typeof BUSINESS_PROFILES)[number];

/**
 * «Team» of a small café: one role that does the whole service — sell, cash in, run its shift,
 * prepare, mark sold out — while money stays with the owner: no reports, no day close, no refunds,
 * no cash movements, and voids or discounts above the thresholds still need the owner's PIN.
 */
export const TEAM_ROLE_PERMISSIONS: readonly Permission[] = [
  'order.create',
  'order.void_item',
  'order.discount',
  'order.transfer',
  'order.any_table',
  'payment.take',
  'receipt.reprint',
  'shift.open',
  'shift.close',
  'kitchen.operate',
  'catalog.sold_out',
  'customer.manage',
];

export interface ProfileDefaults {
  planCode: string;
  serviceStyle: 'tables' | 'counter';
  /** Adds the «Team» role (key `team`). */
  teamRole: boolean;
}

export const PROFILE_DEFAULTS: Readonly<Record<BusinessProfile, ProfileDefaults>> = {
  restaurant: { planCode: 'restaurant', serviceStyle: 'tables', teamRole: false },
  cafe: { planCode: 'cafe', serviceStyle: 'counter', teamRole: true },
};
