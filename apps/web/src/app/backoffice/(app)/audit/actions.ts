'use server';

import { admin, ApiError } from '@pos/api';
import { runAction } from '@/server/action';
import { currentActor, deps } from '@/server/actor';
import { auditQueryOf, parseAuditFilters } from './filters';

/** Next (older) page of the audit log for the same filters (RF-F12). */
export async function loadMoreAuditEvents(filters: unknown, cursor: unknown) {
  return runAction(async () => {
    if (typeof cursor !== 'string' || cursor.length === 0 || cursor.length > 200) {
      throw new ApiError('BAD_REQUEST', 'Invalid cursor');
    }
    const parsed = parseAuditFilters(
      typeof filters === 'object' && filters !== null ? (filters as Record<string, unknown>) : {},
    );
    return admin.listAuditEvents(deps(), await currentActor(), {
      ...auditQueryOf(parsed),
      cursor,
    });
  });
}
