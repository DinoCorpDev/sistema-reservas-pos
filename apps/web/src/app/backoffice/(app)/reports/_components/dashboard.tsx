import { reports } from '@pos/api';
import { Button } from '@pos/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@pos/ui/card';
import type { Trend } from '@pos/ui/stat-card';
import {
  ArmchairIcon,
  ArrowRightIcon,
  ClockIcon,
  CreditCardIcon,
  ReceiptTextIcon,
  WalletIcon,
} from 'lucide-react';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { currentActor, deps } from '@/server/actor';
import { AutoRefresh } from '@/components/auto-refresh';
import { Stat } from './stat';
import { currentFormatter } from '@/server/currency';

/**
 * The owner's view of today (RF-F10), first thing in the backoffice and made for a phone: sales
 * so far against the same day last week, open orders and tables, open shifts and the last Z.
 * Refreshes itself every 30 seconds.
 */
export async function OwnerDashboard() {
  const chf = await currentFormatter();
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

  // Today against the same weekday last week, as a percentage (only when last week sold).
  const trend: Trend | undefined =
    today.lastWeekSalesRappen > 0
      ? (() => {
          const change = Math.round(
            ((today.salesRappen - today.lastWeekSalesRappen) / today.lastWeekSalesRappen) * 100,
          );
          return {
            direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat',
            label: `${change > 0 ? '+' : ''}${format.number(change)} %`,
          };
        })()
      : undefined;

  return (
    <section className="mb-8 grid gap-4" aria-label={t('title')}>
      <AutoRefresh />
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="grid gap-0.5">
          <p className="eyebrow">{t('title')}</p>
          <h2 className="text-lg font-semibold first-letter:uppercase">
            {date(today.businessDate)}
          </h2>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <span aria-hidden className="size-2 rounded-full bg-success ring-4 ring-success/15" />
            {t('refreshed', {
              time: format.dateTime(new Date(today.refreshedAt), { timeStyle: 'short' }),
            })}
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/backoffice/reports">
            {t('more')}
            <ArrowRightIcon />
          </Link>
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label={t('sales')}
          value={chf(today.salesRappen)}
          testId="dashboard-sales"
          icon={<WalletIcon />}
          trend={trend}
          detail={
            <>
              {t('payments', { count: today.paymentCount })} ·{' '}
              {t('lastWeek', { amount: chf(today.lastWeekSalesRappen) })}
            </>
          }
        />
        <Stat
          icon={<ReceiptTextIcon />}
          label={t('openOrders')}
          value={format.number(today.openOrders.count)}
          detail={t('openBalance', { amount: chf(today.openOrders.balanceRappen) })}
        />
        <Stat
          icon={<ArmchairIcon />}
          label={t('tables')}
          value={format.number(today.tables.occupied)}
          detail={`${t('tablesOf', { total: today.tables.total })} · ${t('guests', {
            count: today.openOrders.guests,
          })}`}
        />
        <Stat
          icon={<ClockIcon />}
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
          <CardHeader icon={<CreditCardIcon />}>
            <CardTitle className="text-base">{t('byMethod')}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {today.byMethod.map((line) => (
                <div key={line.key} className="grid gap-0.5 rounded-lg bg-surface-2 px-3 py-2.5">
                  <dt className="eyebrow">{tr(`methods.${line.key}`)}</dt>
                  <dd className="font-semibold tabular-nums">{chf(line.salesRappen)}</dd>
                </div>
              ))}
              <div className="grid gap-0.5 rounded-lg bg-surface-2 px-3 py-2.5">
                <dt className="eyebrow">{t('tips')}</dt>
                <dd className="font-semibold tabular-nums">{chf(today.tipsRappen)}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
