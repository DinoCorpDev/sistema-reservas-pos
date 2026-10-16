import { cash } from '@pos/api';
import { formatChf, rappen } from '@pos/core';
import { Alert } from '@pos/ui/alert';
import { Badge } from '@pos/ui/badge';
import { Button } from '@pos/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pos/ui/card';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { PageHeader } from '@/components/backoffice/page-header';
import { currentActor, deps } from '@/server/actor';
import { ClosingTotals } from '../../closing-totals';
import { PrintButton } from '@/components/print-button';

export const metadata: Metadata = { title: 'Tagesabschluss' };

/**
 * One Z (RF-F03, RF-D17, RN-21): its frozen totals, whether its content still matches its seal,
 * and the money of the day that arrived after it, shown as a correction (never inside it).
 */
export default async function ClosingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await currentActor();
  const t = await getTranslations('cash');
  const format = await getFormatter();
  if (!actor.permissions.has('report.view')) {
    return <Alert variant="warning">{t('noPermission')}</Alert>;
  }
  const closing = await cash.getClosing(deps(), actor, id).catch(() => null);
  if (!closing) notFound();

  return (
    <>
      <PageHeader
        title={t('detail.title', { number: closing.closingNumber, date: closing.businessDate })}
        description={t('detail.description', {
          name: closing.closedByName ?? '?',
          at: format.dateTime(new Date(closing.closedAt), {
            dateStyle: 'medium',
            timeStyle: 'short',
          }),
        })}
        actions={
          <>
            <Button asChild variant="outline" className="print:hidden">
              <Link href={`/backoffice/cash/book?day=${closing.businessDate}`}>
                {t('bookLink')}
              </Link>
            </Button>
            <PrintButton label={t('print')} />
          </>
        }
      />
      <div className="grid gap-6">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          {closing.intact ? (
            <Badge variant="success">{t('detail.intact')}</Badge>
          ) : (
            <Badge variant="destructive">{t('detail.tampered')}</Badge>
          )}
          <span className="font-mono text-xs break-all text-muted-foreground">
            {closing.contentHash}
          </span>
        </p>
        <ClosingTotals totals={closing.totals} />
        {closing.corrections && (
          <Card>
            <CardHeader>
              <CardTitle>{t('detail.corrections', { count: closing.corrections.count })}</CardTitle>
              <CardDescription>{t('detail.correctionsHint')}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm">
                {t('detail.correctionTurnover', {
                  amount: formatChf(rappen(closing.corrections.totals.grossSalesRappen)),
                })}
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
