import { cash, reports } from '@pos/api';
import { formatChf, rappen } from '@pos/core';
import { Card, CardContent, CardHeader, CardTitle } from '@pos/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@pos/ui/table';
import type { Metadata } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';
import { PageHeader } from '@/components/backoffice/page-header';
import { currentActor, deps } from '@/server/actor';
import { PrintButton } from '@/components/print-button';
import { periodOf } from '../_components/period';
import { PeriodFilter } from '../_components/period-filter';
import { Stat, Stats } from '../_components/stat';

export const metadata: Metadata = { title: 'Storno & Rabatte' };

const chf = (value: number) => formatChf(rappen(value));
const KNOWN_REASONS = new Set([
  'entry_error',
  'guest_changed_mind',
  'kitchen_error',
  'quality',
  'not_available',
  'other',
  'staff',
  'courtesy',
  'promotion',
]);

/** Voids, discounts and refunds (RF-F06): by person, by reason and one by one. */
export default async function AdjustmentsReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await currentActor();
  const t = await getTranslations('reports');
  const ta = await getTranslations('reports.adjustments');
  const format = await getFormatter();
  const today = await cash.currentBusinessDay(deps(), actor);
  const { period, invalid } = periodOf(await searchParams, today);
  const report = await reports.getAdjustmentsReport(deps(), actor, period);
  const name = (id: string | null) => (id ? (report.userNames[id] ?? ta('unknown')) : '—');
  const reason = (value: string | null) => {
    if (!value) return ta('noReason');
    // A void reason may carry its free text: "quality: zu kalt".
    const [code, ...rest] = value.split(': ');
    const known = code && KNOWN_REASONS.has(code) ? ta(`reasons.${code}`) : null;
    return known ? [known, ...rest].join(': ') : value;
  };
  const time = (at: string) =>
    format.dateTime(new Date(at), { dateStyle: 'short', timeStyle: 'short' });
  const records = [
    ...report.records.voids.map((r) => ({
      kind: 'void' as const,
      at: r.at,
      userId: r.userId,
      authorizedByUserId: r.authorizedByUserId,
      reason: r.reason,
      what: `${r.quantity} × ${r.productName}`,
      order: r.orderNumber,
      amount: r.grossRappen,
    })),
    ...report.records.discounts.map((r) => ({
      kind: 'discount' as const,
      at: r.at,
      userId: r.userId,
      authorizedByUserId: r.authorizedByUserId,
      reason: r.reason,
      what: '',
      order: r.orderNumber,
      amount: r.amountRappen,
    })),
    ...report.records.refunds.map((r) => ({
      kind: 'refund' as const,
      at: r.at,
      userId: r.userId,
      authorizedByUserId: r.authorizedByUserId,
      reason: r.reason,
      what: '',
      order: r.orderNumber,
      amount: r.amountRappen,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <>
      <PageHeader
        title={ta('title')}
        description={ta('description')}
        actions={<PrintButton label={t('print')} />}
      />
      <PeriodFilter
        path="/backoffice/reports/adjustments"
        period={period}
        today={today}
        invalid={invalid}
      />
      <Stats>
        <Stat
          label={ta('voids')}
          value={chf(report.voids.rappen)}
          detail={`${report.voids.count} ×`}
        />
        <Stat
          label={ta('discounts')}
          value={chf(report.discounts.rappen)}
          detail={`${report.discounts.count} ×`}
        />
        <Stat
          label={ta('refunds')}
          value={chf(report.refunds.rappen)}
          detail={`${report.refunds.count} ×`}
        />
      </Stats>
      <div className="grid gap-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{ta('byPerson')}</CardTitle>
            </CardHeader>
            <CardContent>
              {report.byPerson.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('empty')}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{ta('person')}</TableHead>
                      <TableHead className="text-right">{ta('voids')}</TableHead>
                      <TableHead className="text-right">{ta('discounts')}</TableHead>
                      <TableHead className="text-right">{ta('refunds')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.byPerson.map((person) => (
                      <TableRow key={person.userId ?? 'none'}>
                        <TableCell>{name(person.userId)}</TableCell>
                        {(['voids', 'discounts', 'refunds'] as const).map((field) => (
                          <TableCell
                            key={field}
                            className="text-right whitespace-nowrap tabular-nums"
                          >
                            {person[field].count > 0
                              ? `${person[field].count} · ${chf(person[field].rappen)}`
                              : '—'}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{ta('byReason')}</CardTitle>
            </CardHeader>
            <CardContent>
              {report.byReason.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('empty')}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{ta('kind')}</TableHead>
                      <TableHead>{ta('reason')}</TableHead>
                      <TableHead className="text-right">{ta('count')}</TableHead>
                      <TableHead className="text-right">{ta('amount')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.byReason.map((line) => (
                      <TableRow key={`${line.kind}:${line.reason ?? ''}`}>
                        <TableCell>{ta(`kinds.${line.kind}`)}</TableCell>
                        <TableCell>{reason(line.reason)}</TableCell>
                        <TableCell className="text-right whitespace-nowrap tabular-nums">
                          {line.count}
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap tabular-nums">
                          {chf(line.rappen)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{ta('records')}</CardTitle>
          </CardHeader>
          <CardContent>
            {records.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('empty')}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{ta('time')}</TableHead>
                    <TableHead>{ta('kind')}</TableHead>
                    <TableHead>{ta('order')}</TableHead>
                    <TableHead>{ta('product')}</TableHead>
                    <TableHead>{ta('reason')}</TableHead>
                    <TableHead>{ta('person')}</TableHead>
                    <TableHead>{ta('authorized')}</TableHead>
                    <TableHead className="text-right">{ta('amount')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.map((record, index) => (
                    <TableRow key={index} data-testid="adjustment-record">
                      <TableCell className="whitespace-nowrap tabular-nums">
                        {time(record.at)}
                      </TableCell>
                      <TableCell>{ta(`kinds.${record.kind}`)}</TableCell>
                      <TableCell className="font-mono">{record.order}</TableCell>
                      <TableCell>{record.what}</TableCell>
                      <TableCell>{reason(record.reason)}</TableCell>
                      <TableCell>{name(record.userId)}</TableCell>
                      <TableCell>
                        {record.authorizedByUserId ? name(record.authorizedByUserId) : ''}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap tabular-nums">
                        {chf(record.amount)}
                      </TableCell>
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
