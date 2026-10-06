import { admin, people } from '@pos/api';
import { Alert } from '@pos/ui/alert';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@/components/backoffice/page-header';
import { currentActor, deps } from '@/server/actor';
import { AuditLog } from './audit-log';
import { auditFiltersFromSearch, auditQueryOf } from './filters';

export const metadata: Metadata = { title: 'Protokoll' };

/** Audit query (RF-F11, RF-F12): newest first, filtered by date, action, object and person. */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await currentActor();
  const t = await getTranslations('audit');
  if (!actor.permissions.has('audit.view')) {
    return (
      <>
        <PageHeader title={t('title')} />
        <Alert variant="warning">{t('noPermission')}</Alert>
      </>
    );
  }
  const filters = auditFiltersFromSearch(await searchParams);
  // Names instead of ids where the caller may see them; the log itself only stores ids.
  const [page, users, terminals] = await Promise.all([
    admin.listAuditEvents(deps(), actor, auditQueryOf(filters)),
    actor.permissions.has('user.manage')
      ? people.listUsers(deps(), actor).catch(() => [])
      : Promise.resolve([]),
    actor.locationId ? people.listTerminals(deps(), actor).catch(() => []) : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <AuditLog
        key={`${JSON.stringify(filters)}:${page.items[0]?.id ?? ''}`}
        filters={filters}
        initial={page}
        users={users.map((user) => ({ id: user.id, name: user.displayName }))}
        terminals={terminals.map((terminal) => ({ id: terminal.id, name: terminal.name }))}
      />
    </>
  );
}
