import { admin, type Actor, people } from '@pos/api';
import { toCsv } from '@pos/core';
import { getTranslations } from 'next-intl/server';
import { deps } from '@/server/actor';

/**
 * The audit log matching a filter as a file (RF-F12, RF-F13): CSV (`;`, UTF-8 with BOM) with
 * names where the caller may see them, or JSON as stored. Newest first, at most
 * `AUDIT_EXPORT_MAX_ROWS` events. Needs `audit.view` (checked by the service).
 */
export async function auditExportFile(
  actor: Actor,
  query: Omit<admin.AuditQuery, 'cursor' | 'limit'>,
  format: 'csv' | 'json',
  name: string,
): Promise<Response> {
  const exported = await admin.exportAuditEvents(deps(), actor, query);
  const headers = (type: string) => ({
    'content-type': `${type}; charset=utf-8`,
    'content-disposition': `attachment; filename="${name}.${format}"`,
    'cache-control': 'no-store',
  });
  if (format === 'json') {
    return new Response(JSON.stringify(exported, null, 2), {
      headers: headers('application/json'),
    });
  }
  const c = await getTranslations('reports.export.columns');
  const [users, terminals] = await Promise.all([
    actor.permissions.has('user.manage')
      ? people.listUsers(deps(), actor).catch(() => [])
      : Promise.resolve([]),
    actor.locationId ? people.listTerminals(deps(), actor).catch(() => []) : Promise.resolve([]),
  ]);
  const user = new Map(users.map((u) => [u.id, u.displayName]));
  const terminal = new Map(terminals.map((d) => [d.id, d.name]));
  const nameOf = (map: Map<string, string>, id: string | null) => (id ? (map.get(id) ?? id) : '');
  const csv = toCsv(
    [
      c('time'),
      c('action'),
      c('entity'),
      c('entityId'),
      c('user'),
      c('authorizedBy'),
      c('terminal'),
      c('reason'),
      c('before'),
      c('after'),
    ],
    exported.items.map((event) => [
      event.occurredAt,
      event.action,
      event.entityType,
      event.entityId,
      nameOf(user, event.userId),
      nameOf(user, event.authorizedByUserId),
      nameOf(terminal, event.terminalId),
      event.reason,
      event.before === null ? '' : JSON.stringify(event.before),
      event.after === null ? '' : JSON.stringify(event.after),
    ]),
  );
  return new Response(csv, { headers: headers('text/csv') });
}
