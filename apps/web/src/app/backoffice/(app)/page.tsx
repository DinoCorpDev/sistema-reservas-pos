import { admin } from '@pos/api';
import { Alert } from '@pos/ui/alert';
import { Button } from '@pos/ui/button';
import { MonitorIcon } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { auth } from '@/auth';
import { QuickActions } from '@/components/backoffice/admin/overview/quick-actions';
import { SetupChecklist } from '@/components/backoffice/admin/overview/setup-checklist';
import { LowStockCard } from '@/components/backoffice/inventory/low-stock-card';
import { PageHeader } from '@/components/backoffice/page-header';
import { currentActor, deps } from '@/server/actor';
import { OwnerDashboard } from './reports/_components/dashboard';

export const metadata: Metadata = { title: 'Übersicht' };

/**
 * Overview of the location: a greeting, today's figures for whoever may see reports (RF-F10),
 * the usual destinations, then what is still missing before it can operate (RF-A11).
 */
export default async function OverviewPage() {
  const actor = await currentActor();
  const session = await auth();
  const t = await getTranslations('overview');
  const firstName = session?.user?.name?.trim().split(/\s+/)[0];
  const header = (
    <PageHeader
      nav="overview"
      eyebrow={t('title')}
      title={firstName ? t('greeting', { name: firstName }) : t('title')}
      description={t('subtitle')}
      actions={
        <Button asChild>
          {/* The POS opens in its own tab: it is an app of its own (offline, PIN). */}
          <a href="/pos" target="_blank" rel="noopener">
            <MonitorIcon aria-hidden />
            {t('openPos')}
          </a>
        </Button>
      }
    />
  );
  if (!actor.locationId) {
    return (
      <>
        {header}
        <Alert variant="info">{t('noLocation')}</Alert>
      </>
    );
  }
  const checklist = await admin.getSetupChecklist(deps(), actor);
  return (
    <>
      {header}
      {actor.permissions.has('report.view') && <OwnerDashboard />}
      <QuickActions permissions={actor.permissions} />
      {actor.permissions.has('inventory.manage') && <LowStockCard />}
      <SetupChecklist
        checklist={checklist}
        canActivate={actor.permissions.has('location.manage')}
      />
    </>
  );
}
