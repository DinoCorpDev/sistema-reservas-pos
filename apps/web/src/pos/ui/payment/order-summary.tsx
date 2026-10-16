'use client';

import { type FoldState, itemsOf, type OrderState, paymentsOf, rappen, refundsOf } from '@pos/core';
import { formatPosMoney } from '@/pos/money';
import { Badge } from '@pos/ui/badge';
import { cn } from '@pos/ui/utils';
import { useTranslations } from 'next-intl';

/**
 * The bill being collected (RF-D02): its lines, total, what was already paid and the open
 * balance, which the screen always shows (`payment-balance`).
 */
export function OrderSummary({
  order,
  fold,
  className,
}: {
  order: OrderState;
  fold: FoldState;
  className?: string;
}) {
  const t = useTranslations('posPayment.summary');
  const tm = useTranslations('posPayment.methods');
  const items = itemsOf(fold, order.id).filter((item) => item.prepStatus !== 'voided');
  const payments = paymentsOf(fold, order.id).sort((a, b) =>
    a.completedAt.localeCompare(b.completedAt),
  );
  const refunded = refundsOf(fold, order.id).reduce((sum, refund) => sum + refund.amountRappen, 0);
  const unsent = items.filter((item) => item.prepStatus === 'pending').length;

  return (
    <section
      aria-labelledby="payment-summary-title"
      className={cn('flex min-h-0 flex-col gap-3 rounded-xl border bg-card p-4', className)}
    >
      <h2 id="payment-summary-title" className="text-base font-semibold">
        {t('title')}
      </h2>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('noLines')}</p>
      ) : (
        <ul aria-label={t('lines')} className="-mx-1 max-h-[45dvh] divide-y overflow-y-auto px-1">
          {items.map((item) => (
            <li key={item.id} className="flex items-start justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="leading-snug">
                  <span className="tabular-nums">{item.quantity}</span> ×{' '}
                  {item.variantName ? `${item.name} (${item.variantName})` : item.name}
                </p>
                {item.modifiers.length > 0 && (
                  <p className="text-sm text-muted-foreground">
                    {item.modifiers
                      .map((m) => (m.quantity > 1 ? `${m.quantity} × ${m.name}` : m.name))
                      .join(', ')}
                  </p>
                )}
                <div className="mt-0.5 flex flex-wrap gap-1">
                  {item.seat !== null && (
                    <Badge variant="outline">{t('seat', { seat: item.seat })}</Badge>
                  )}
                  {item.discountRappen > 0 && (
                    <Badge variant="secondary">
                      {t('discount')} {formatPosMoney(rappen(-item.discountRappen))}
                    </Badge>
                  )}
                </div>
              </div>
              <span className="shrink-0 tabular-nums">{formatPosMoney(item.lineTotalRappen)}</span>
            </li>
          ))}
        </ul>
      )}

      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t pt-3 text-sm">
        {order.discountTotalRappen > 0 && (
          <>
            <dt className="text-muted-foreground">{t('subtotal')}</dt>
            <dd className="text-right tabular-nums">{formatPosMoney(order.subtotalRappen)}</dd>
            <dt className="text-muted-foreground">{t('discount')}</dt>
            <dd className="text-right tabular-nums">
              {formatPosMoney(rappen(-order.discountTotalRappen))}
            </dd>
          </>
        )}
        <dt className="font-medium">{t('total')}</dt>
        <dd className="text-right font-medium tabular-nums" data-testid="payment-total">
          {formatPosMoney(order.totalRappen)}
        </dd>
        {(payments.length > 0 || order.paidRappen !== 0) && (
          <>
            <dt className="text-muted-foreground">{t('paid')}</dt>
            <dd className="text-right tabular-nums" data-testid="payment-paid">
              {formatPosMoney(order.paidRappen)}
            </dd>
          </>
        )}
        {order.tipTotalRappen > 0 && (
          <>
            <dt className="text-muted-foreground">{t('tips')}</dt>
            <dd className="text-right tabular-nums">{formatPosMoney(order.tipTotalRappen)}</dd>
          </>
        )}
        <dt className="self-center text-base font-semibold">{t('balance')}</dt>
        <dd
          className={cn(
            'text-right text-2xl font-bold tabular-nums',
            order.balanceRappen > 0 ? 'text-foreground' : 'text-success',
          )}
          data-testid="payment-balance"
        >
          {formatPosMoney(order.balanceRappen)}
        </dd>
      </dl>

      {payments.length > 0 && (
        <div className="grid gap-1 border-t pt-3">
          <h3 className="text-sm font-medium text-muted-foreground">{t('payments')}</h3>
          <ul className="grid gap-1 text-sm">
            {payments.map((payment) => (
              <li key={payment.id} className="flex items-center justify-between gap-3">
                <span>
                  {tm(payment.method)}
                  {payment.splitLabel ? ` (${payment.splitLabel})` : ''}
                  {payment.tipRappen > 0 && (
                    <span className="text-muted-foreground">
                      {' '}
                      · {t('tips')} {formatPosMoney(payment.tipRappen)}
                    </span>
                  )}
                </span>
                <span className="tabular-nums">{formatPosMoney(payment.amountRappen)}</span>
              </li>
            ))}
            {refunded > 0 && (
              <li className="flex items-center justify-between gap-3 text-destructive">
                <span>{t('refunded')}</span>
                <span className="tabular-nums">{formatPosMoney(rappen(-refunded))}</span>
              </li>
            )}
          </ul>
        </div>
      )}

      {unsent > 0 && order.status === 'open' && (
        <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
          {t('unsent', { count: unsent })}
        </p>
      )}
    </section>
  );
}
