import { cash, reports } from '@pos/api';
import { formatChf, rappen } from '@pos/core';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pos/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@pos/ui/table';
import type { Metadata } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/backoffice/page-header';
import { currentActor, deps } from '@/server/actor';
import { PrintButton } from '@/components/print-button';
import { HourBars } from './_components/hour-bars';
import { periodOf } from './_components/period';
import { PeriodFilter } from './_components/period-filter';
import { Stat, Stats } from './_components/stat';

export const metadata: Metadata = { title: 'Berichte' };

const chf = (value: number) => formatChf(rappen(value));
const PRODUCTS_SHOWN = 30;

/** Two columns of a breakdown: a name and its sales, with the count in between when known. */
function Breakdown({
  title,
  head,
  rows,
  empty,
}: {
  title: string;
  head: [string, string, string];
  rows: { key: string; name: ReactNode; count: ReactNode; amount: number }[];
  empty: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{head[0]}</TableHead>
                <TableHead className="text-right">{head[1]}</TableHead>
                <TableHead className="text-right">{head[2]}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.key}>
                  <TableCell>{row.name}</TableCell>
                  <TableCell className="text-right whitespace-nowrap tabular-nums">
                    {row.count}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap tabular-nums">
                    {chf(row.amount)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Sales of a period (RF-F01): the total as in the Zs, the comparison with the period before,
 * and the sales by day, hour, waiter, channel, payment method, category and product.
 */
export default async function SalesReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await currentActor();
  const t = await getTranslations('reports');
  const ts = await getTranslations('reports.sales');
  const format = await getFormatter();
  const today = await cash.currentBusinessDay(deps(), actor);
  const { period, invalid } = periodOf(await searchParams, today);
  const report = await reports.getSalesReport(deps(), actor, period);
  const { sales, items, previous } = report;
  const name = (id: string | null) =>
    id ? (report.userNames[id] ?? t('adjustments.unknown')) : ts('noWaiter');
  const day = (date: string) =>
    format.dateTime(new Date(`${date}T12:00:00Z`), {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'UTC',
    });
  const change =
    previous.changePerMille === null
      ? ts('noBase')
      : `${previous.changePerMille >= 0 ? '+' : '−'}${format.number(
          Math.abs(previous.changePerMille) / 10,
          { maximumFractionDigits: 1 },
        )} % · ${ts('change', {
          from: previous.from,
          to: previous.to,
          amount: chf(previous.salesRappen),
        })}`;

  return (
    <>
      <PageHeader
        title={t('tabs.sales')}
        description={t('period.label', { from: day(period.from), to: day(period.to) })}
        actions={<PrintButton label={t('print')} />}
      />
      <PeriodFilter path="/backoffice/reports" period={period} today={today} invalid={invalid} />
      <Stats>
        <Stat
          label={ts('total')}
          value={chf(sales.salesRappen)}
          detail={change}
          testId="report-sales-total"
          rappen={sales.salesRappen}
        />
        <Stat
          label={ts('payments')}
          value={format.number(sales.paymentCount)}
          detail={
            sales.paymentCount > 0
              ? `${ts('average')}: ${chf(Math.round(sales.salesRappen / sales.paymentCount))}`
              : undefined
          }
        />
        <Stat label={ts('tips')} value={chf(sales.tipsRappen)} />
        <Stat
          label={ts('refunds')}
          value={chf(sales.refundsRappen)}
          detail={`${format.number(sales.refundCount)} · ${ts('rounding')}: ${chf(sales.roundingRappen)}`}
        />
      </Stats>
      <p className="-mt-3 mb-6 text-sm text-muted-foreground">{ts('totalHint')}</p>

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{ts('byHour')}</CardTitle>
          </CardHeader>
          <CardContent>
            <HourBars hours={sales.byHour} />
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Breakdown
            title={ts('byDay')}
            head={[ts('day'), ts('count'), ts('amount')]}
            empty={t('empty')}
            rows={sales.byDay.map((line) => ({
              key: line.key,
              name: day(line.key),
              count: line.paymentCount,
              amount: line.salesRappen,
            }))}
          />
          <Breakdown
            title={ts('byWaiter')}
            head={[ts('person'), ts('count'), ts('amount')]}
            empty={t('empty')}
            rows={sales.byWaiter.map((line) => ({
              key: line.key ?? 'none',
              name: name(line.key),
              count: line.paymentCount,
              amount: line.salesRappen,
            }))}
          />
          <Breakdown
            title={ts('byChannel')}
            head={[ts('channel'), ts('count'), ts('amount')]}
            empty={t('empty')}
            rows={sales.byChannel.map((line) => ({
              key: line.key,
              name: t(`channels.${line.key}`),
              count: line.paymentCount,
              amount: line.salesRappen,
            }))}
          />
          <Breakdown
            title={ts('byMethod')}
            head={[ts('method'), ts('count'), ts('amount')]}
            empty={t('empty')}
            rows={sales.byMethod.map((line) => ({
              key: line.key,
              name: t(`methods.${line.key}`),
              count: line.paymentCount,
              amount: line.salesRappen,
            }))}
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {ts('byCategory')} · {ts('byProduct')}
            </CardTitle>
            <CardDescription>
              {ts('itemsNote')}{' '}
              {report.itemsDifferenceRappen !== 0 &&
                ts('difference', { amount: chf(report.itemsDifferenceRappen) })}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 lg:grid-cols-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{ts('category')}</TableHead>
                  <TableHead className="text-right">{ts('quantity')}</TableHead>
                  <TableHead className="text-right">{ts('amount')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.byCategory.map((line) => (
                  <TableRow key={line.id ?? 'none'}>
                    <TableCell>{line.name ?? ts('noCategory')}</TableCell>
                    <TableCell className="text-right whitespace-nowrap tabular-nums">
                      {line.quantity}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap tabular-nums">
                      {chf(line.salesRappen)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="grid gap-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{ts('product')}</TableHead>
                    <TableHead className="text-right">{ts('quantity')}</TableHead>
                    <TableHead className="text-right">{ts('amount')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.byProduct.slice(0, PRODUCTS_SHOWN).map((line) => (
                    <TableRow key={line.id ?? `name:${line.name}`}>
                      <TableCell>
                        {line.name}
                        {line.categoryName ? (
                          <span className="block text-xs text-muted-foreground">
                            {line.categoryName}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap tabular-nums">
                        {line.quantity}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap tabular-nums">
                        {chf(line.salesRappen)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {items.byProduct.length > PRODUCTS_SHOWN && (
                <p className="text-sm text-muted-foreground">
                  {ts('showing', { count: PRODUCTS_SHOWN, total: items.byProduct.length })}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
