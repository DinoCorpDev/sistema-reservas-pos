import { inventory } from '@pos/api';
import { formatQuantity, type MovementKind, type StockUnit } from '@pos/core';
import { Button } from '@pos/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@pos/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@pos/ui/table';
import { ArrowLeftIcon } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { PageHeader } from '@/components/backoffice/page-header';
import { currentActor, deps } from '@/server/actor';

export const metadata: Metadata = { title: 'Inventar' };

/** One raw material: its movements by hand and what sales took per day (DEC-051). */
export default async function IngredientHistoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await currentActor();
  const t = await getTranslations('inventory');
  const tShort = await getTranslations('inventory.unitShort');
  const locale = await getLocale();
  const { ingredient, movements, days } = await inventory.ingredientHistory(deps(), actor, id);
  const quantity = (value: number, unit: StockUnit = ingredient.unit) => {
    const text = formatQuantity(value, unit, locale);
    return unit === 'unit' ? `${text} ${tShort('unit')}` : text;
  };
  const signed = (value: number) => (value > 0 ? `+${quantity(value)}` : quantity(value));
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' });

  return (
    <>
      <PageHeader
        title={t('history.title', { name: ingredient.name })}
        description={`${t('onHand')}: ${quantity(ingredient.onHand ?? 0)}`}
        actions={
          <Button asChild variant="outline">
            <Link href="/backoffice/inventory">
              <ArrowLeftIcon /> {t('history.back')}
            </Link>
          </Button>
        }
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('history.movements')}</CardTitle>
            <CardDescription>{t('history.movementsHint')}</CardDescription>
          </CardHeader>
          {movements.length === 0 ? (
            <p className="text-muted-foreground">{t('history.noMovements')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('history.date')}</TableHead>
                  <TableHead>{t('history.kind')}</TableHead>
                  <TableHead className="text-right">{t('history.change')}</TableHead>
                  <TableHead>{t('history.by')}</TableHead>
                  <TableHead>{t('history.note')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movements.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="whitespace-nowrap">
                      {dateTime.format(new Date(m.occurredAt))}
                    </TableCell>
                    <TableCell>
                      {t(`movement.kinds.${m.kind as MovementKind}`)}
                      {m.countedQuantity !== null ? (
                        <span className="block text-xs text-muted-foreground">
                          {t('history.counted')}: {quantity(m.countedQuantity)}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{signed(m.quantity)}</TableCell>
                    <TableCell>{m.userName ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{m.note ?? ''}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('history.days')}</CardTitle>
            <CardDescription>{t('history.daysHint')}</CardDescription>
          </CardHeader>
          {days.length === 0 ? (
            <p className="text-muted-foreground">{t('history.noDays')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('history.date')}</TableHead>
                  <TableHead className="text-right">{t('history.sold')}</TableHead>
                  <TableHead className="text-right">{t('history.wasted')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {days.map((d) => (
                  <TableRow key={d.businessDate}>
                    <TableCell>{date.format(new Date(`${d.businessDate}T00:00:00Z`))}</TableCell>
                    <TableCell className="text-right tabular-nums">{quantity(d.sold)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {d.wasted > 0 ? quantity(d.wasted) : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
