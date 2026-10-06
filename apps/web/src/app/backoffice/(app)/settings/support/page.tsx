import { admin, people } from '@pos/api';
import { Alert } from '@pos/ui/alert';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@/components/backoffice/page-header';
import { currentActor, deps } from '@/server/actor';
import { SupportAccess } from './support-access';

export const metadata: Metadata = { title: 'Support-Zugang' };

/** Time-limited access for DINOLABS support, granted and revoked by the owner (RF-A10). */
export default async function SupportAccessPage() {
  const actor = await currentActor();
  const t = await getTranslations('supportAccess');
  if (!actor.permissions.has('support.grant_access')) {
    return (
      <>
        <PageHeader title={t('title')} />
        <Alert variant="warning">{t('noPermission')}</Alert>
      </>
    );
  }
  const [grants, users] = await Promise.all([
    admin.listSupportGrants(deps(), actor),
    actor.permissions.has('user.manage')
      ? people.listUsers(deps(), actor).catch(() => [])
      : Promise.resolve([]),
  ]);
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <SupportAccess
        grants={grants}
        userNames={Object.fromEntries(users.map((user) => [user.id, user.displayName]))}
        canManage={actor.kind === 'user'}
      />
    </>
  );
}
