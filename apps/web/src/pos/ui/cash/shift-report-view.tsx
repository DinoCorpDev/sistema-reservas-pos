'use client';

import { formatChf, rappen, type ShiftReport } from '@pos/core';
import { useFormatter, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

const chf = (value: number) => formatChf(rappen(value));

function Row({ label, value, strong }: { label: ReactNode; value: number; strong?: boolean }) {
  return (
    <div
      className={strong ? 'flex justify-between gap-3 font-semibold' : 'flex justify-between gap-3'}
    >
      <dt>{label}</dt>
      <dd className="tabular-nums">{chf(value)}</dd>
    </div>
  );
}

/**
 * A shift report (X while open, the closing report at the end, RF-D15): what the till or the
 * wallet took per method, what went back, MWST per rate, tips, rounding, discounts, voids,
 * movements and the cash that should be there. Shown on screen and printed as it is.
 */
export function ShiftReportView({
  report,
  counted,
}: {
  report: ShiftReport;
  /** At the close: what was counted (the difference is shown). */
  counted?: number;
}) {
  const t = useTranslations('posCash.report');
  const tm = useTranslations('posPayment.methods');
  const tk = useTranslations('posCash.movement');
  const format = useFormatter();
  const time = (iso: string) =>
    format.dateTime(new Date(iso), {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: report.timeZone,
    });
  const tips =
    report.payments.reduce((sum, p) => sum + p.tipRappen, 0) -
    report.refunds.reduce((sum, r) => sum + r.tipRappen, 0);
  const rounding =
    report.payments.reduce((sum, p) => sum + p.roundingRappen, 0) -
    report.refunds.reduce((sum, r) => sum + r.roundingRappen, 0);
  return (
    <article className="grid gap-4 text-sm" data-testid="shift-report">
      <header className="grid gap-0.5">
        <h3 className="text-base font-semibold">{report.ownerName}</h3>
        <p className="text-muted-foreground">
          {t('period', { from: time(report.openedAt), to: time(report.closedAt) })}
        </p>
      </header>

      <section className="grid gap-1">
        <h4 className="font-medium">{t('payments')}</h4>
        {report.payments.length === 0 ? (
          <p className="text-muted-foreground">{t('none')}</p>
        ) : (
          <dl className="grid gap-0.5">
            {report.payments.map((p) => (
              <Row
                key={p.method}
                label={`${tm(p.method)} · ${t('count', { count: p.count })}`}
                value={p.collectedRappen}
              />
            ))}
          </dl>
        )}
      </section>

      {report.refunds.length > 0 && (
        <section className="grid gap-1">
          <h4 className="font-medium">{t('refunds')}</h4>
          <dl className="grid gap-0.5">
            {report.refunds.map((r) => (
              <Row
                key={r.method}
                label={`${tm(r.method)} · ${t('count', { count: r.count })}`}
                value={-r.paidOutRappen}
              />
            ))}
          </dl>
        </section>
      )}

      {report.taxes.length > 0 && (
        <section className="grid gap-1">
          <h4 className="font-medium">{t('taxes')}</h4>
          <table className="w-full tabular-nums">
            <thead className="text-muted-foreground">
              <tr>
                <th className="text-left font-normal">{t('rate')}</th>
                <th className="text-right font-normal">{t('gross')}</th>
                <th className="text-right font-normal">{t('tax')}</th>
                <th className="text-right font-normal">{t('net')}</th>
              </tr>
            </thead>
            <tbody>
              {report.taxes.map((rate) => (
                <tr key={`${rate.rateCode}${rate.rateBp}`}>
                  <td>{(rate.rateBp / 100).toFixed(1)} %</td>
                  <td className="text-right">
                    {formatChf(rappen(rate.grossRappen), { currency: false })}
                  </td>
                  <td className="text-right">
                    {formatChf(rappen(rate.taxRappen), { currency: false })}
                  </td>
                  <td className="text-right">
                    {formatChf(rappen(rate.netRappen), { currency: false })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <dl className="grid gap-0.5">
        <Row label={t('tips')} value={tips} />
        <Row label={t('rounding')} value={rounding} />
        <Row
          label={t('discounts', { count: report.discountCount })}
          value={report.discountsRappen}
        />
        <Row label={t('voids', { count: report.voidCount })} value={report.voidsRappen} />
      </dl>

      <section className="grid gap-1 rounded-lg bg-muted px-3 py-2">
        <h4 className="font-medium">{t('cash')}</h4>
        <dl className="grid gap-0.5">
          <Row label={t('float')} value={report.cash.openingFloatRappen} />
          <Row label={t('collected')} value={report.cash.collectedRappen} />
          {report.cash.paidOutRappen !== 0 && (
            <Row label={t('paidOut')} value={-report.cash.paidOutRappen} />
          )}
          {report.movements.map((m) => (
            <Row
              key={m.kind}
              label={`${tk(`kind_${m.kind}`)} · ${t('count', { count: m.count })}`}
              value={m.amountRappen}
            />
          ))}
          <Row label={t('expected')} value={report.cash.expectedRappen} strong />
          {counted !== undefined && (
            <>
              <Row label={t('counted')} value={counted} strong />
              <Row label={t('difference')} value={counted - report.cash.expectedRappen} strong />
            </>
          )}
        </dl>
      </section>
    </article>
  );
}
