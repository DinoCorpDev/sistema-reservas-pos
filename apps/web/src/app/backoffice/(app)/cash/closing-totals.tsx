import { type DailyClosingTotals, formatChf, rappen } from '@pos/core';
import { Card, CardContent, CardHeader, CardTitle } from '@pos/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@pos/ui/table';
import { getTranslations } from 'next-intl/server';

const chf = (value: number) => formatChf(rappen(value));
const num = 'text-right tabular-nums';

/**
 * The figures of a Z (RF-D15): turnover per payment method and per MWST rate, tips, rounding,
 * discounts, voids, refunds, the cash of every shift and the terminal reconciliations. The same
 * view serves the preview, the closing and its printout.
 */
export async function ClosingTotals({ totals }: { totals: DailyClosingTotals }) {
  const t = await getTranslations('cash.totals');
  const tm = await getTranslations('posPayment.methods');
  return (
    <div
      className="grid gap-4 lg:grid-cols-2 print:grid-cols-1"
      data-testid="closing-totals"
      data-sales-rappen={totals.grossSalesRappen}
      data-tax-rappen={totals.byTaxRate.reduce((sum, rate) => sum + rate.taxRappen, 0)}
    >
      <Card>
        <CardHeader>
          <CardTitle>{t('turnover', { amount: chf(totals.grossSalesRappen) })}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('method')}</TableHead>
                <TableHead className="text-right">{t('sales')}</TableHead>
                <TableHead className="text-right">{t('tips')}</TableHead>
                <TableHead className="text-right">{t('total')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {totals.byPaymentMethod.map((m) => (
                <TableRow key={m.method}>
                  <TableCell>
                    {tm(m.method)} <span className="text-muted-foreground">({m.paymentCount})</span>
                  </TableCell>
                  <TableCell className={num}>{chf(m.salesRappen)}</TableCell>
                  <TableCell className={num}>{chf(m.tipsRappen)}</TableCell>
                  <TableCell className={`${num} font-medium`}>{chf(m.totalRappen)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <dl className="mt-4 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
            <dt>{t('tipsTotal')}</dt>
            <dd className={num}>{chf(totals.tipsRappen)}</dd>
            <dt>{t('rounding')}</dt>
            <dd className={num}>{chf(totals.roundingRappen)}</dd>
            <dt>{t('refunds', { count: totals.refundCount })}</dt>
            <dd className={num}>{chf(totals.refundsRappen)}</dd>
            <dt>{t('discounts', { count: totals.discountCount })}</dt>
            <dd className={num}>{chf(totals.discountsRappen)}</dd>
            <dt>{t('voids', { count: totals.voidCount })}</dt>
            <dd className={num}>{chf(totals.voidsRappen)}</dd>
            <dt>{t('orders')}</dt>
            <dd className={num}>{totals.orderCount}</dd>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('vat')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('rate')}</TableHead>
                <TableHead className="text-right">{t('gross')}</TableHead>
                <TableHead className="text-right">{t('net')}</TableHead>
                <TableHead className="text-right">{t('tax')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {totals.byTaxRate.map((rate) => (
                <TableRow key={`${rate.rateCode}${rate.rateBp}`}>
                  <TableCell>{(rate.rateBp / 100).toFixed(1)} %</TableCell>
                  <TableCell className={num}>{chf(rate.grossRappen)}</TableCell>
                  <TableCell className={num}>{chf(rate.netRappen)}</TableCell>
                  <TableCell className={num}>{chf(rate.taxRappen)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('cash')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
            <dt>{t('float')}</dt>
            <dd className={num}>{chf(totals.cash.openingFloatRappen)}</dd>
            <dt>{t('collected')}</dt>
            <dd className={num}>{chf(totals.cash.collectedRappen)}</dd>
            <dt>{t('paidOut')}</dt>
            <dd className={num}>{chf(-totals.cash.paidOutRappen)}</dd>
            <dt>{t('movements')}</dt>
            <dd className={num}>{chf(totals.cash.movementsRappen)}</dd>
            <dt className="font-medium">{t('expected')}</dt>
            <dd className={`${num} font-medium`}>{chf(totals.cash.expectedRappen)}</dd>
            <dt className="font-medium">{t('counted')}</dt>
            <dd className={`${num} font-medium`}>{chf(totals.cash.countedRappen)}</dd>
            <dt className="font-medium">{t('difference')}</dt>
            <dd className={`${num} font-medium`}>{chf(totals.cash.differenceRappen)}</dd>
            {totals.cash.unassignedRappen !== 0 && (
              <>
                <dt>{t('unassigned')}</dt>
                <dd className={num}>{chf(totals.cash.unassignedRappen)}</dd>
              </>
            )}
          </dl>
          {totals.shifts.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('shift')}</TableHead>
                  <TableHead className="text-right">{t('expected')}</TableHead>
                  <TableHead className="text-right">{t('counted')}</TableHead>
                  <TableHead className="text-right">{t('difference')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {totals.shifts.map((shift) => (
                  <TableRow key={shift.id}>
                    <TableCell>
                      {shift.ownerName}
                      {shift.differenceComment && (
                        <span className="block text-xs text-muted-foreground">
                          {shift.differenceComment}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className={num}>{chf(shift.expectedCashRappen ?? 0)}</TableCell>
                    <TableCell className={num}>{chf(shift.countedCashRappen ?? 0)}</TableCell>
                    <TableCell className={num}>{chf(shift.differenceRappen ?? 0)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {totals.reconciliations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('reconciliation')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('method')}</TableHead>
                  <TableHead className="text-right">{t('pos')}</TableHead>
                  <TableHead className="text-right">{t('terminal')}</TableHead>
                  <TableHead className="text-right">{t('difference')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {totals.reconciliations.map((r) => (
                  <TableRow key={r.method}>
                    <TableCell>
                      {tm(r.method)}
                      {r.reason && (
                        <span className="block text-xs text-muted-foreground">{r.reason}</span>
                      )}
                    </TableCell>
                    <TableCell className={num}>{chf(r.posTotalRappen)}</TableCell>
                    <TableCell className={num}>{chf(r.terminalTotalRappen)}</TableCell>
                    <TableCell className={num}>{chf(r.differenceRappen)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
