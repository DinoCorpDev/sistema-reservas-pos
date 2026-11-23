import { cash, reports } from '@pos/api';
import { Card, CardContent } from '@pos/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@pos/ui/table';
import { EmptyState } from '@pos/ui/empty-state';
import { InboxIcon } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@/components/backoffice/page-header';
import { currentActor, deps } from '@/server/actor';
import { PrintButton } from '@/components/print-button';
import { periodOf } from '../_components/period';
import { PeriodFilter } from '../_components/period-filter';
import { currentFormatter } from '@/server/currency';

export const metadata: Metadata = { title: 'Trinkgeld' };

/** Tips by person (RF-F07): outside the sales and without MWST (RN-07). */
export default async function TipsReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const chf = await currentFormatter();
  const actor = await currentActor();
  const t = await getTranslations('reports');
  const tt = await getTranslations('reports.tips');
  const today = await cash.currentBusinessDay(deps(), actor);
  const { period, invalid } = periodOf(await searchParams, today);
  const report = await reports.getTipsReport(deps(), actor, period);

  return (
    <>
      <PageHeader
        nav="reports"
        title={tt('title')}
        description={tt('description')}
        actions={<PrintButton label={t('print')} />}
      />
      <PeriodFilter
        path="/backoffice/reports/tips"
        period={period}
        today={today}
        invalid={invalid}
      />
      <Card>
        <CardContent className="pt-6">
          {report.byPerson.length === 0 ? (
            <EmptyState compact icon={<InboxIcon />} title={t('empty')} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tt('person')}</TableHead>
                  <TableHead className="text-right">{tt('count')}</TableHead>
                  <TableHead className="text-right">{tt('amount')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.byPerson.map((line) => (
                  <TableRow key={line.userId ?? 'none'}>
                    <TableCell>{line.name ?? tt('unknown')}</TableCell>
                    <TableCell className="text-right whitespace-nowrap tabular-nums">
                      {line.count}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap tabular-nums">
                      {chf(line.tipsRappen)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2">
                  <TableCell className="font-semibold">{tt('total')}</TableCell>
                  <TableCell />
                  <TableCell
                    className="text-right font-semibold whitespace-nowrap tabular-nums"
                    data-testid="tips-total"
                  >
                    {chf(report.tipsRappen)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
