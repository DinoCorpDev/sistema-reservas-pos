'use client';

import type { OrderState } from '@pos/core';
import { cn } from '@pos/ui/utils';
import { Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { BackButton } from './back-button';
import type { Lookups } from './hooks';
import { PAYMENT_STATUS_STYLES } from './status';

/** Who and where: order number (RF-C15), table, guests, waiter and channel. */
export function OrderHeader({ order, lookups }: { order: OrderState; lookups: Lookups }) {
  const t = useTranslations('posOrder.order');
  const tc = useTranslations('posOrder.common');
  const tch = useTranslations('posOrder.channel');
  const tp = useTranslations('posOrder.paymentStatus');
  const table = order.tableId ? lookups.tables.get(order.tableId) : undefined;
  const joined = order.joinedTableIds
    .map((id) => lookups.tables.get(id)?.label)
    .filter((label): label is string => Boolean(label));
  const waiter = lookups.users.get(order.waiterUserId)?.displayName ?? tc('unknownUser');

  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-card px-3 py-2">
      <BackButton variant="outline" short />
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-xl font-bold">
          {table ? tc('table', { label: table.label }) : tch(order.channel)}
          {joined.length > 0 && (
            <span className="ml-1 text-base font-medium text-muted-foreground">
              + {joined.join(', ')}
            </span>
          )}
        </h1>
        <span className="text-sm text-muted-foreground">
          {t('number')}{' '}
          <span
            data-testid="order-number"
            className="font-mono text-base font-semibold text-foreground"
          >
            {order.displayNumber}
          </span>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {order.guestCount !== null && order.guestCount > 0 && (
          <span className="inline-flex items-center gap-1">
            <Users className="size-4" aria-hidden />
            {tc('guests', { count: order.guestCount })}
          </span>
        )}
        <span className="text-muted-foreground">{t('waiter', { name: waiter })}</span>
        {table && order.channel !== 'table' && (
          <span className="rounded bg-muted px-2 py-0.5">{tch(order.channel)}</span>
        )}
        {order.customerName && <span className="font-medium">{order.customerName}</span>}
        {order.paymentStatus !== 'unpaid' && (
          <span
            className={cn(
              'rounded px-2 py-0.5 font-medium',
              PAYMENT_STATUS_STYLES[order.paymentStatus],
            )}
          >
            {tp(order.paymentStatus)}
          </span>
        )}
      </div>
    </header>
  );
}
