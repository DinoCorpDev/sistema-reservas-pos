import { Alert } from '@pos/ui/alert';
import { getTranslations } from 'next-intl/server';
import { type ReactNode, Suspense } from 'react';
import { PageHeader } from '@/components/backoffice/page-header';
import { currentActor } from '@/server/actor';
import { ReportTabs } from './_components/report-tabs';

/** Reports (RF-F01…RF-F08, RF-F13): one section, one tab per report, the same period. */
export default async function ReportsLayout({ children }: { children: ReactNode }) {
  const actor = await currentActor();
  const t = await getTranslations('reports');
  if (!actor.permissions.has('report.view')) {
    return (
      <>
        <PageHeader nav="reports" title={t('title')} />
        <Alert variant="warning">{t('noPermission')}</Alert>
      </>
    );
  }
  return (
    <>
      <Suspense>
        <ReportTabs />
      </Suspense>
      {children}
    </>
  );
}
