import { reports } from '@pos/api';
import { formatChf, rappen } from '@pos/core';
import { Button } from '@pos/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@pos/ui/card';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { currentActor, deps } from '@/server/actor';
import { AutoRefresh } from '@/components/auto-refresh';
import { Stat } from './stat';

const chf = (value: number) => formatChf(rappen(value));

/**
 * The owner's view of today (RF-F10), first thing in the backoffice and made for a phone: sales
 * so far against the same day last week, open orders and tables, open shifts and the last Z.
 * Refreshes itself every 30 seconds.
 */
export async function OwnerDashboard() {
  const actor = await currentActor();
  const t = await getTranslations('reports.dashboard');
  const tr = await getTranslations('reports');
  const format = await getFormatter();
  const today = await reports.getDashboard(deps(), actor);
  const date = (iso: string) =>
    format.dateTime(new Date(`${iso}T12:00:00Z`), {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    });

  return (
    <section className="mb-8 grid gap-4" aria-label={t('title')}>
      <AutoRefresh />
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">
            {t('title')} · {date(today.businessDate)}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t('refreshed', {
              time: format.dateTime(new Date(today.refreshedAt), { timeStyle: 'short' }),
            })}
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/backoffice/reports">{t('more')}</Link>
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label={t('sales')}
          value={chf(today.salesRappen)}
          testId="dashboard-sales"
          detail={
            <>
              {t('payments', { count: today.paymentCount })}
              <br />
              {t('lastWeek', { amount: chf(today.lastWeekSalesRappen) })}
            </>
          }
        />
        <Stat
          label={t('openOrders')}
          value={format.number(today.openOrders.count)}
          detail={t('openBalance', { amount: chf(today.openOrders.balanceRappen) })}
        />
        <Stat
          label={t('tables')}
          value={format.number(today.tables.occupied)}
          detail={`${t('tablesOf', { total: today.tables.total })} · ${t('guests', {
            count: today.openOrders.guests,
          })}`}
        />
        <Stat
          label={t('shifts')}
          value={format.number(today.openShifts)}
          detail={
            today.lastClosing
              ? t('lastClosing', {
                  number: today.lastClosing.closingNumber,
                  date: format.dateTime(new Date(`${today.lastClosing.businessDate}T12:00:00Z`), {
                    dateStyle: 'short',
                    timeZone: 'UTC',
                  }),
                })
              : t('noClosing')
          }
        />
      </div>
      {today.byMethod.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('byMethod')}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 lg:grid-cols-5">
              {today.byMethod.map((line) => (
                <div key={line.key} className="grid">
                  <dt className="text-sm text-muted-foreground">{tr(`methods.${line.key}`)}</dt>
                  <dd className="font-medium tabular-nums">{chf(line.salesRappen)}</dd>
                </div>
              ))}
              <div className="grid">
                <dt className="text-sm text-muted-foreground">{t('tips')}</dt>
                <dd className="font-medium tabular-nums">{chf(today.tipsRappen)}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
