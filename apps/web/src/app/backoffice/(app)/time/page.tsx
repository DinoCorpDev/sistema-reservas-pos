import { cash, people } from '@pos/api';
import { formatWorked } from '@pos/core';
import { Alert } from '@pos/ui/alert';
import { Button } from '@pos/ui/button';
import { StatCard } from '@pos/ui/stat-card';
import { DownloadIcon, TimerIcon, TriangleAlertIcon, UsersIcon } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@/components/backoffice/page-header';
import { currentActor, deps } from '@/server/actor';
import { periodOf, periodQuery, presetPeriod } from '../reports/_components/period';
import { PeriodFilter } from '../reports/_components/period-filter';
import { Timesheet } from './timesheet';

export const metadata: Metadata = { title: 'Arbeitszeit' };

/**
 * The staff's working time (RF-A09, DEC-054): who clocked in and out, the hours per person, what
 * the manager has to complete, and the export for the payroll. This week unless chosen.
 */
export default async function TimePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await currentActor();
  const t = await getTranslations('time');
  const header = <PageHeader nav="time" title={t('title')} description={t('description')} />;
  if (!actor.permissions.has('time.manage')) {
    return (
      <>
        {header}
        <Alert variant="warning">{t('noPermission')}</Alert>
      </>
    );
  }
  if (!actor.locationId) {
    return (
      <>
        {header}
        <Alert variant="info">{t('noLocation')}</Alert>
      </>
    );
  }
  const today = await cash.currentBusinessDay(deps(), actor);
  const params = await searchParams;
  const chosen = params.from !== undefined || params.to !== undefined;
  const { period, invalid } = chosen
    ? periodOf(params, today)
    : { period: presetPeriod('thisWeek', today), invalid: false };
  const sheet = await people.listTimeEntries(deps(), actor, period);
  const working = sheet.entries.filter((entry) => entry.status === 'open').length;

  return (
    <>
      <PageHeader
        nav="time"
        title={t('title')}
        description={t('description')}
        actions={
          <Button asChild variant="outline">
            <a href={`/backoffice/time/export?${periodQuery(period)}`} download>
              <DownloadIcon /> {t('export')}
            </a>
          </Button>
        }
      />
      <PeriodFilter path="/backoffice/time" period={period} today={today} invalid={invalid} />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard
          label={t('summary.total')}
          value={formatWorked(sheet.totalMinutes)}
          icon={<TimerIcon />}
          detail={t('summary.people', { count: sheet.people.length })}
          testId="time-total"
        />
        <StatCard
          label={t('summary.working')}
          value={working}
          icon={<UsersIcon />}
          tone={working > 0 ? 'success' : 'muted'}
          detail={t('summary.workingHint')}
        />
        <StatCard
          label={t('summary.incomplete')}
          value={sheet.incomplete}
          icon={<TriangleAlertIcon />}
          tone={sheet.incomplete > 0 ? 'warning' : 'muted'}
          detail={t('summary.incompleteHint')}
          testId="time-incomplete"
        />
      </div>
      <Timesheet sheet={sheet} />
    </>
  );
}
