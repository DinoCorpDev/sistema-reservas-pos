import { cash } from '@pos/api';
import { formatChf, rappen } from '@pos/core';
import { Alert } from '@pos/ui/alert';
import { Badge } from '@pos/ui/badge';
import { Button } from '@pos/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pos/ui/card';
import { Input } from '@pos/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@pos/ui/table';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@/components/backoffice/page-header';
import { currentActor, deps } from '@/server/actor';
import { ClosingTotals } from './closing-totals';
import { DayCloseForm } from './day-close-form';

export const metadata: Metadata = { title: 'Kasse' };

const isDate = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

/**
 * Cash of the location (RF-D11…RF-D19, RF-F03): the day close with what still stops it, the
 * terminal reconciliation and the Z; below, the closings already made and the cash book.
 */
export default async function CashPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await currentActor();
  const t = await getTranslations('cash');
  const canClose = actor.permissions.has('day.close');
  const canView = actor.permissions.has('report.view');
  if (!canClose && !canView) {
    return (
      <>
        <PageHeader title={t('title')} />
        <Alert variant="warning">{t('noPermission')}</Alert>
      </>
    );
  }
  const params = await searchParams;
  const today = await cash.currentBusinessDay(deps(), actor);
  const day = isDate(params.day) ? params.day : today;
  const [preview, closings] = await Promise.all([
    canClose ? cash.previewDayClose(deps(), actor, day) : Promise.resolve(null),
    canView ? cash.listClosings(deps(), actor) : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          canView ? (
            <Button asChild variant="outline">
              <Link href={`/backoffice/cash/book?day=${day}`}>{t('bookLink')}</Link>
            </Button>
          ) : null
        }
      />
      <div className="grid gap-6">
        <form className="flex flex-wrap items-end gap-2" action="/backoffice/cash">
          <label className="grid gap-1 text-sm font-medium">
            {t('day')}
            <Input type="date" name="day" defaultValue={day} max={today} className="w-auto" />
          </label>
          <Button type="submit" variant="secondary">
            {t('show')}
          </Button>
        </form>

        {preview && (
          <Card>
            <CardHeader>
              <CardTitle>{t('close.title', { date: day })}</CardTitle>
              <CardDescription>{t('close.description')}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              {preview.closing ? (
                <Alert>
                  {t('close.already', { number: preview.closing.closingNumber })}{' '}
                  <Link
                    className="underline"
                    href={`/backoffice/cash/closings/${preview.closing.id}`}
                  >
                    {t('open')}
                  </Link>
                </Alert>
              ) : !preview.canClose ? (
                <Alert variant="warning">
                  <p className="font-medium">{t('close.blockers')}</p>
                  <ul className="mt-2 list-disc pl-5 text-sm">
                    {preview.blockers.future && <li>{t('close.future')}</li>}
                    {preview.blockers.previousDayOpen && (
                      <li>
                        <Link
                          className="underline"
                          href={`/backoffice/cash?day=${preview.blockers.previousDayOpen}`}
                        >
                          {t('close.previousDay', { date: preview.blockers.previousDayOpen })}
                        </Link>
                      </li>
                    )}
                    {preview.blockers.openShifts.map((shift) => (
                      <li key={shift.id}>
                        {t('close.openShift', { name: shift.ownerName, date: shift.businessDate })}
                      </li>
                    ))}
                    {preview.blockers.openOrders.map((order) => (
                      <li key={order.id}>
                        {t('close.openOrder', {
                          number: order.displayNumber,
                          amount: formatChf(rappen(order.balanceRappen)),
                        })}
                      </li>
                    ))}
                  </ul>
                </Alert>
              ) : (
                <DayCloseForm businessDate={day} toReconcile={preview.toReconcile} />
              )}
              {preview.warnings.unresolvedConflicts > 0 && (
                <p className="text-sm text-muted-foreground">
                  <Link className="underline" href="/backoffice/sync-conflicts">
                    {t('close.conflicts', { count: preview.warnings.unresolvedConflicts })}
                  </Link>
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {preview && !preview.closing && <ClosingTotals totals={preview.totals} />}

        {canView && (
          <Card>
            <CardHeader>
              <CardTitle>{t('closings')}</CardTitle>
            </CardHeader>
            <CardContent>
              {closings.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('noClosings')}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('number')}</TableHead>
                      <TableHead>{t('date')}</TableHead>
                      <TableHead className="text-right">{t('turnover')}</TableHead>
                      <TableHead className="text-right">{t('cashDifference')}</TableHead>
                      <TableHead>{t('closedBy')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {closings.map((closing) => (
                      <TableRow key={closing.id}>
                        <TableCell>
                          <Link
                            className="font-medium underline"
                            href={`/backoffice/cash/closings/${closing.id}`}
                          >
                            Z {closing.closingNumber}
                          </Link>
                        </TableCell>
                        <TableCell>{closing.businessDate}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatChf(rappen(closing.totals.grossSalesRappen))}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {closing.totals.cash.differenceRappen === 0 ? (
                            formatChf(rappen(0))
                          ) : (
                            <Badge variant="warning">
                              {formatChf(rappen(closing.totals.cash.differenceRappen))}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>{closing.closedByName}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
