import { cash, reports } from '@pos/api';
import { formatChf, rappen } from '@pos/core';
import { Card, CardContent } from '@pos/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@pos/ui/table';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@/components/backoffice/page-header';
import { currentActor, deps } from '@/server/actor';
import { PrintButton } from '@/components/print-button';
import { periodOf } from '../_components/period';
import { PeriodFilter } from '../_components/period-filter';

export const metadata: Metadata = { title: 'Trinkgeld' };

const chf = (value: number) => formatChf(rappen(value));

/** Tips by person (RF-F07): outside the sales and without MWST (RN-07). */
export default async function TipsReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await currentActor();
  const t = await getTranslations('reports');
  const tt = await getTranslations('reports.tips');
  const today = await cash.currentBusinessDay(deps(), actor);
  const { period, invalid } = periodOf(await searchParams, today);
  const report = await reports.getTipsReport(deps(), actor, period);

  return (
    <>
      <PageHeader
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
            <p className="text-sm text-muted-foreground">{t('empty')}</p>
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
