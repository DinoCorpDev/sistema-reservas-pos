import { cash, reports } from '@pos/api';
import type { DurationStats } from '@pos/core';
import { Card, CardContent, CardHeader, CardTitle } from '@pos/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@pos/ui/table';
import { EmptyState } from '@pos/ui/empty-state';
import { InboxIcon } from 'lucide-react';
import type { Metadata } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';
import { PageHeader } from '@/components/backoffice/page-header';
import { currentActor, deps } from '@/server/actor';
import { PrintButton } from '@/components/print-button';
import { periodOf } from '../_components/period';
import { PeriodFilter } from '../_components/period-filter';

export const metadata: Metadata = { title: 'Zeiten' };

/** Kitchen times by station and product, table times by table (RF-F08). */
export default async function TimesReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await currentActor();
  const t = await getTranslations('reports');
  const tt = await getTranslations('reports.times');
  const format = await getFormatter();
  const today = await cash.currentBusinessDay(deps(), actor);
  const { period, invalid } = periodOf(await searchParams, today);
  const report = await reports.getTimesReport(deps(), actor, period);
  const minutes = (seconds: number) =>
    tt('minutes', { value: format.number(seconds / 60, { maximumFractionDigits: 1 }) });
  const head = (first: string, extra?: string) => (
    <TableHeader>
      <TableRow>
        <TableHead>{first}</TableHead>
        {extra ? <TableHead>{extra}</TableHead> : null}
        <TableHead className="text-right">{tt('count')}</TableHead>
        <TableHead className="text-right">{tt('median')}</TableHead>
        <TableHead className="text-right">{tt('p90')}</TableHead>
        <TableHead className="text-right">{tt('average')}</TableHead>
        <TableHead className="text-right">{tt('max')}</TableHead>
      </TableRow>
    </TableHeader>
  );
  const cells = (stats: DurationStats) => (
    <>
      <TableCell className="text-right whitespace-nowrap tabular-nums">{stats.count}</TableCell>
      <TableCell className="text-right font-medium whitespace-nowrap tabular-nums">
        {minutes(stats.medianSeconds)}
      </TableCell>
      <TableCell className="text-right whitespace-nowrap tabular-nums">
        {minutes(stats.p90Seconds)}
      </TableCell>
      <TableCell className="text-right whitespace-nowrap tabular-nums">
        {minutes(stats.averageSeconds)}
      </TableCell>
      <TableCell className="text-right whitespace-nowrap tabular-nums">
        {minutes(stats.maxSeconds)}
      </TableCell>
    </>
  );
  const station = (id: string) => report.stationNames[id] ?? '?';

  return (
    <>
      <PageHeader
        nav="reports"
        title={tt('title')}
        description={tt('description')}
        actions={<PrintButton label={t('print')} />}
      />
      <PeriodFilter
        path="/backoffice/reports/times"
        period={period}
        today={today}
        invalid={invalid}
      />
      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{tt('kitchen')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-6">
            {!report.kitchen.overall ? (
              <EmptyState compact icon={<InboxIcon />} title={t('empty')} />
            ) : (
              <>
                <Table>
                  {head(tt('station'))}
                  <TableBody>
                    <TableRow className="bg-muted/40">
                      <TableCell className="font-medium">{tt('overall')}</TableCell>
                      {cells(report.kitchen.overall)}
                    </TableRow>
                    {report.kitchen.byStation.map((line) => (
                      <TableRow key={line.stationId} data-testid="time-station">
                        <TableCell>{station(line.stationId)}</TableCell>
                        {cells(line.stats)}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <Table>
                  {head(tt('product'), tt('station'))}
                  <TableBody>
                    {report.kitchen.byProduct.map((line) => (
                      <TableRow key={`${line.stationId}:${line.productId ?? line.productName}`}>
                        <TableCell>{line.productName}</TableCell>
                        <TableCell>{station(line.stationId)}</TableCell>
                        {cells(line.stats)}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{tt('tables')}</CardTitle>
          </CardHeader>
          <CardContent>
            {!report.tables.overall ? (
              <EmptyState compact icon={<InboxIcon />} title={t('empty')} />
            ) : (
              <Table>
                {head(tt('table'), tt('guests'))}
                <TableBody>
                  <TableRow className="bg-muted/40">
                    <TableCell className="font-medium">{tt('overall')}</TableCell>
                    <TableCell />
                    {cells(report.tables.overall)}
                  </TableRow>
                  {report.tables.byTable.map((line) => (
                    <TableRow key={line.tableId}>
                      <TableCell>{report.tableLabels[line.tableId] ?? '?'}</TableCell>
                      <TableCell className="tabular-nums">{line.guests}</TableCell>
                      {cells(line.stats)}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
