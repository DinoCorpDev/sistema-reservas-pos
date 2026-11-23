import { people, sync } from '@pos/api';
import { Alert } from '@pos/ui/alert';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@/components/backoffice/page-header';
import { currentActor, deps } from '@/server/actor';
import { currentCurrency } from '@/server/currency';
import { ConflictList } from './conflict-list';
import { toConflictRows } from './rows';

export const metadata: Metadata = { title: 'Synchronisationskonflikte' };

/**
 * Synchronization conflicts of the current location (RNF-04, docs/SYNC.md §5): operations made
 * offline that broke a rule were applied anyway; the manager reviews and resolves each one.
 */
export default async function SyncConflictsPage({
  searchParams,
}: {
  searchParams: Promise<{ resolved?: string | string[] }>;
}) {
  const actor = await currentActor();
  const t = await getTranslations('syncConflicts');
  if (!actor.permissions.has('sync.resolve_conflicts')) {
    return (
      <>
        <PageHeader nav="syncConflicts" title={t('title')} />
        <Alert variant="warning">{t('noPermission')}</Alert>
      </>
    );
  }
  if (!actor.locationId) {
    return (
      <>
        <PageHeader nav="syncConflicts" title={t('title')} />
        <Alert variant="warning">{t('noLocation')}</Alert>
      </>
    );
  }
  const { resolved } = await searchParams;
  const includeResolved = (Array.isArray(resolved) ? resolved[0] : resolved) === '1';
  // Names instead of ids where the caller may see them; the operations only store ids.
  const [conflicts, users, terminals] = await Promise.all([
    sync.listConflicts(deps(), actor, { includeResolved }),
    actor.permissions.has('user.manage')
      ? people.listUsers(deps(), actor).catch(() => [])
      : Promise.resolve([]),
    people.listTerminals(deps(), actor).catch(() => []),
  ]);

  return (
    <>
      <PageHeader nav="syncConflicts" title={t('title')} description={t('description')} />
      <ConflictList
        rows={toConflictRows(conflicts, await currentCurrency())}
        includeResolved={includeResolved}
        users={users.map((user) => ({ id: user.id, name: user.displayName }))}
        terminals={terminals.map((terminal) => ({ id: terminal.id, name: terminal.name }))}
      />
    </>
  );
}
