import { cash } from '@pos/api';
import { Button } from '@pos/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pos/ui/card';
import { DownloadIcon } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@/components/backoffice/page-header';
import { currentActor, deps } from '@/server/actor';
import { periodOf, periodQuery } from '../_components/period';
import { PeriodFilter } from '../_components/period-filter';

export const metadata: Metadata = { title: 'Export' };

const FILES = [
  { kind: 'accounting', formats: ['csv'] },
  { kind: 'vat', formats: ['csv'] },
  { kind: 'receipts', formats: ['csv', 'json'] },
  { kind: 'closings', formats: ['csv', 'json'] },
  { kind: 'cashbook', formats: ['csv'] },
  { kind: 'audit', formats: ['csv', 'json'], permission: 'audit.view' },
] as const;

/**
 * Export and archive of a period (RF-F04, RF-F13, RNF-15): the accounting file, MWST, receipts,
 * closings, cash books and the audit log, ready for the fiduciary and the 10-year retention.
 */
export default async function ExportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await currentActor();
  const t = await getTranslations('reports');
  const te = await getTranslations('reports.export');
  const today = await cash.currentBusinessDay(deps(), actor);
  const { period, invalid } = periodOf(await searchParams, today);
  const visible = FILES.filter(
    (entry) => !('permission' in entry) || actor.permissions.has(entry.permission),
  );

  return (
    <>
      <PageHeader title={te('title')} description={te('description')} />
      <PeriodFilter
        path="/backoffice/reports/export"
        period={period}
        today={today}
        invalid={invalid}
      />
      <div className="grid gap-4 md:grid-cols-2">
        {visible.map((entry) => (
          <Card key={entry.kind}>
            <CardHeader>
              <CardTitle className="text-base">{te(entry.kind)}</CardTitle>
              <CardDescription>{te(`${entry.kind}Hint`)}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {entry.formats.map((format) => (
                <Button key={format} asChild variant="outline">
                  <a
                    href={`/backoffice/reports/export/${entry.kind}?${periodQuery(period, { format })}`}
                    download
                    data-testid={`export-${entry.kind}-${format}`}
                  >
                    <DownloadIcon /> {t(format)}
                  </a>
                </Button>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
