import type { admin } from '@pos/api';
import { AUDIT_ACTIONS } from '@pos/core';
import {
  addDays,
  isIsoDate,
  UUID_PATTERN,
  zurichStartOfDay,
} from '@/components/backoffice/admin/format';

/** Audit filters as they travel in the URL and to the "load more" action (strings, '' = none). */
export interface AuditFilters {
  from: string;
  to: string;
  action: string;
  entityType: string;
  userId: string;
  terminalId: string;
}

export const AUDIT_PAGE_SIZE = 50;

/** Known entity types written by the Core, for the filter (other values still show as they are). */
export const AUDIT_ENTITY_TYPES = [
  'order',
  'payment',
  'receipt',
  'shift',
  'product',
  'category',
  'modifier_group',
  'tax_category',
  'tax_rate',
  'tax_rule',
  'customer',
  'location',
  'organization',
  'user',
  'role',
  'terminal',
  'phone_pairing_code',
  'approval',
  'api_key',
  'support_grant',
] as const;

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

/** Validates untrusted filters (URL or client); anything invalid is dropped. */
export function parseAuditFilters(raw: Record<string, unknown>): AuditFilters {
  const from = text(raw.from);
  const to = text(raw.to);
  const action = text(raw.action);
  const entityType = text(raw.entityType);
  const userId = text(raw.userId).toLowerCase();
  const terminalId = text(raw.terminalId).toLowerCase();
  return {
    from: isIsoDate(from) ? from : '',
    to: isIsoDate(to) ? to : '',
    action: (AUDIT_ACTIONS as readonly string[]).includes(action) ? action : '',
    entityType: /^[a-z_]{1,48}$/.test(entityType) ? entityType : '',
    userId: UUID_PATTERN.test(userId) ? userId : '',
    terminalId: UUID_PATTERN.test(terminalId) ? terminalId : '',
  };
}

/** URL parameters → filters (`entity`, `user` and `terminal` are the short URL names). */
export const auditFiltersFromSearch = (params: Record<string, string | string[] | undefined>) =>
  parseAuditFilters({
    from: params.from,
    to: params.to,
    action: params.action,
    entityType: params.entity,
    userId: params.user,
    terminalId: params.terminal,
  });

/**
 * Dates are calendar days in Zürich: `from` includes the whole first day and `to` the whole last
 * day (the use case's upper bound is exclusive).
 */
export function auditQueryOf(filters: AuditFilters): admin.AuditQuery {
  return {
    from: filters.from ? zurichStartOfDay(filters.from) : undefined,
    to: filters.to ? zurichStartOfDay(addDays(filters.to, 1)) : undefined,
    action: filters.action || undefined,
    entityType: filters.entityType || undefined,
    userId: filters.userId || undefined,
    terminalId: filters.terminalId || undefined,
    limit: AUDIT_PAGE_SIZE,
  };
}
