import { cash } from '@pos/api';
import { formatChf, rappen } from '@pos/core';
import { Alert } from '@pos/ui/alert';
import { Button } from '@pos/ui/button';
import { Card, CardContent } from '@pos/ui/card';
import { Input } from '@pos/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@pos/ui/table';
import type { Metadata } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';
import { PageHeader } from '@/components/backoffice/page-header';
import { currentActor, deps } from '@/server/actor';
import { PrintButton } from '@/components/print-button';

export const metadata: Metadata = { title: 'Kassenbuch' };

const chf = (value: number) => formatChf(rappen(value), { currency: false });

/**
 * The daily cash book (Kassenbuch, RF-D16): every franc that entered or left a drawer, in time
 * order with the running balance. Printable (and saved as PDF from the print dialog) and as CSV.
 */
export default async function CashBookPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await currentActor();
  const t = await getTranslations('cash');
  const tb = await getTranslations('cash.book');
  const format = await getFormatter();
  if (!actor.permissions.has('report.view')) {
    return <Alert variant="warning">{t('noPermission')}</Alert>;
  }
  const params = await searchParams;
  const today = await cash.currentBusinessDay(deps(), actor);
  const day =
    typeof params.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(params.day) ? params.day : today;
  const book = await cash.getCashBook(deps(), actor, day);
  const owner = new Map(book.shifts.map((shift) => [shift.id, shift.ownerName]));

  return (
    <>
      <PageHeader
        title={tb('title', { date: day })}
        description={tb('description')}
        actions={
          <>
            <Button asChild variant="outline" className="print:hidden">
              <a href={`/backoffice/cash/book/export?day=${day}`} download>
                {tb('csv')}
              </a>
            </Button>
            <PrintButton label={t('print')} />
          </>
        }
      />
      <form
        className="mb-4 flex flex-wrap items-end gap-2 print:hidden"
        action="/backoffice/cash/book"
      >
        <label className="grid gap-1 text-sm font-medium">
          {t('day')}
          <Input type="date" name="day" defaultValue={day} max={today} className="w-auto" />
        </label>
        <Button type="submit" variant="secondary">
          {t('show')}
        </Button>
      </form>
      <Card>
        <CardContent className="pt-6">
          {book.lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tb('empty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tb('time')}</TableHead>
                  <TableHead>{tb('kind')}</TableHead>
                  <TableHead>{tb('reference')}</TableHead>
                  <TableHead>{tb('shift')}</TableHead>
                  <TableHead className="text-right">{tb('in')}</TableHead>
                  <TableHead className="text-right">{tb('out')}</TableHead>
                  <TableHead className="text-right">{tb('balance')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {book.lines.map((line, index) => (
                  <TableRow key={index}>
                    <TableCell className="tabular-nums">
                      {format.dateTime(new Date(line.at), { timeStyle: 'short' })}
                    </TableCell>
                    <TableCell>{tb(`kinds.${line.kind}`)}</TableCell>
                    <TableCell>{line.reference}</TableCell>
                    <TableCell>{line.shiftId ? owner.get(line.shiftId) : ''}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {line.amountRappen >= 0 ? chf(line.amountRappen) : ''}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {line.amountRappen < 0 ? chf(-line.amountRappen) : ''}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {chf(line.balanceRappen)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell colSpan={4} className="font-medium">
                    {tb('totals')}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {chf(book.inRappen)}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {chf(book.outRappen)}
                  </TableCell>
                  <TableCell className="text-right font-bold tabular-nums">
                    {chf(book.endBalanceRappen)}
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
