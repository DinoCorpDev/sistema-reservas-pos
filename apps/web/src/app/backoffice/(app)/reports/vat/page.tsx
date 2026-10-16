import { cash, reports } from '@pos/api';
import { formatChf, rappen, VAT_GRANULARITIES, type VatGranularity } from '@pos/core';
import { Button } from '@pos/ui/button';
import { Card, CardContent } from '@pos/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@pos/ui/table';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Fragment } from 'react';
import { PageHeader } from '@/components/backoffice/page-header';
import { currentActor, deps } from '@/server/actor';
import { PrintButton } from '@/components/print-button';
import { periodOf, periodQuery } from '../_components/period';
import { PeriodFilter } from '../_components/period-filter';

export const metadata: Metadata = { title: 'MWST' };

const chf = (value: number) => formatChf(rappen(value), { currency: false });

/**
 * MWST by rate and period (RF-F02): turnover, tax and net per rate by month, quarter or
 * half-year for the return; net of refunds, from the receipts, like the Z.
 */
export default async function VatReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await currentActor();
  const t = await getTranslations('reports');
  const tv = await getTranslations('reports.vat');
  const format = await getFormatter();
  const params = await searchParams;
  const today = await cash.currentBusinessDay(deps(), actor);
  const { period, invalid } = periodOf(params, today);
  const granularity: VatGranularity = VAT_GRANULARITIES.includes(
    params.granularity as VatGranularity,
  )
    ? (params.granularity as VatGranularity)
    : 'month';
  const report = await reports.getVatReport(deps(), actor, { ...period, granularity });
  const percent = (bp: number) => `${format.number(bp / 100, { minimumFractionDigits: 1 })} %`;
  const rateName = (code: string) =>
    ['normal', 'reduced', 'accommodation'].includes(code) ? tv(`rates.${code}`) : code;

  return (
    <>
      <PageHeader
        title={tv('title')}
        description={tv('description')}
        actions={
          <>
            <Button asChild variant="outline" className="print:hidden">
              <a
                href={`/backoffice/reports/export/vat?${periodQuery(period, { granularity })}`}
                download
              >
                {t('csv')}
              </a>
            </Button>
            <PrintButton label={t('print')} />
          </>
        }
      />
      <PeriodFilter
        path="/backoffice/reports/vat"
        period={period}
        today={today}
        invalid={invalid}
        extra={{ granularity }}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <span className="text-sm font-medium">{tv('granularity')}</span>
        {VAT_GRANULARITIES.map((option) => (
          <Button
            key={option}
            asChild
            variant={option === granularity ? 'default' : 'outline'}
            className="min-h-11"
          >
            <Link href={`/backoffice/reports/vat?${periodQuery(period, { granularity: option })}`}>
              {tv(`granularities.${option}`)}
            </Link>
          </Button>
        ))}
      </div>
      <Card>
        <CardContent className="pt-6">
          {report.periods.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('empty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tv('period')}</TableHead>
                  <TableHead>{tv('rate')}</TableHead>
                  <TableHead className="text-right">{tv('gross')}</TableHead>
                  <TableHead className="text-right">{tv('tax')}</TableHead>
                  <TableHead className="text-right">{tv('net')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.periods.map((line) => (
                  <Fragment key={line.key}>
                    {line.byTaxRate.map((rate, index) => (
                      <TableRow key={`${line.key}:${rate.rateBp}`}>
                        <TableCell className="font-medium">{index === 0 ? line.key : ''}</TableCell>
                        <TableCell>
                          {rateName(rate.rateCode)} {percent(rate.rateBp)}
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap tabular-nums">
                          {chf(rate.grossRappen)}
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap tabular-nums">
                          {chf(rate.taxRappen)}
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap tabular-nums">
                          {chf(rate.netRappen)}
                        </TableCell>
                      </TableRow>
                    ))}
                    {report.periods.length > 1 && (
                      <TableRow className="bg-muted/40">
                        <TableCell />
                        <TableCell className="font-medium">{tv('total')}</TableCell>
                        <TableCell className="text-right font-medium whitespace-nowrap tabular-nums">
                          {chf(line.grossRappen)}
                        </TableCell>
                        <TableCell className="text-right font-medium whitespace-nowrap tabular-nums">
                          {chf(line.taxRappen)}
                        </TableCell>
                        <TableCell className="text-right font-medium whitespace-nowrap tabular-nums">
                          {chf(line.netRappen)}
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))}
                {report.byTaxRate.map((rate) => (
                  <TableRow key={`total:${rate.rateBp}`} className="border-t-2">
                    <TableCell className="font-semibold">{tv('total')}</TableCell>
                    <TableCell>
                      {rateName(rate.rateCode)} {percent(rate.rateBp)}
                    </TableCell>
                    <TableCell className="text-right font-semibold whitespace-nowrap tabular-nums">
                      {chf(rate.grossRappen)}
                    </TableCell>
                    <TableCell className="text-right font-semibold whitespace-nowrap tabular-nums">
                      {chf(rate.taxRappen)}
                    </TableCell>
                    <TableCell className="text-right font-semibold whitespace-nowrap tabular-nums">
                      {chf(rate.netRappen)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell className="font-bold">{tv('total')}</TableCell>
                  <TableCell />
                  <TableCell
                    className="text-right font-bold whitespace-nowrap tabular-nums"
                    data-testid="vat-gross"
                  >
                    {chf(report.grossRappen)}
                  </TableCell>
                  <TableCell
                    className="text-right font-bold whitespace-nowrap tabular-nums"
                    data-testid="vat-tax"
                    data-rappen={report.taxRappen}
                  >
                    {chf(report.taxRappen)}
                  </TableCell>
                  <TableCell className="text-right font-bold whitespace-nowrap tabular-nums">
                    {chf(report.netRappen)}
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
