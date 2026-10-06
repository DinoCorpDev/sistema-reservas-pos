import { admin } from '@pos/api';
import { Alert } from '@pos/ui/alert';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SetupChecklist } from '@/components/backoffice/admin/overview/setup-checklist';
import { PageHeader } from '@/components/backoffice/page-header';
import { currentActor, deps } from '@/server/actor';

export const metadata: Metadata = { title: 'Übersicht' };

/** Overview of the location: what is still missing before it can operate (RF-A11). */
export default async function OverviewPage() {
  const actor = await currentActor();
  const t = await getTranslations('overview');
  if (!actor.locationId) {
    return (
      <>
        <PageHeader title={t('title')} />
        <Alert variant="info">{t('noLocation')}</Alert>
      </>
    );
  }
  const checklist = await admin.getSetupChecklist(deps(), actor);
  return (
    <>
      <PageHeader title={t('title')} />
      <SetupChecklist checklist={checklist} canActivate={actor.permissions.has('location.manage')} />
    </>
  );
}
