import { toApiError } from '@pos/api';
import { currentActor } from '@/server/actor';
import { auditExportFile } from '../export-file';
import { auditFiltersFromSearch, auditQueryOf } from '../filters';

/** The audit log with the filters of the page, as CSV or JSON (RF-F12). */
export async function GET(request: Request) {
  const search = new URL(request.url).searchParams;
  const filters = auditFiltersFromSearch(Object.fromEntries(search));
  const { limit: _limit, ...query } = auditQueryOf(filters);
  const format = search.get('format') === 'json' ? 'json' : 'csv';
  const stamp = new Date().toISOString().slice(0, 10);
  try {
    return await auditExportFile(await currentActor(), query, format, `audit-${stamp}`);
  } catch (error) {
    const apiError = toApiError(error);
    return new Response(apiError.message, { status: apiError.status });
  }
}
