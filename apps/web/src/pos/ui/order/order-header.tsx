'use client';

import type { OrderState } from '@pos/core';
import { Button } from '@pos/ui/button';
import { cn } from '@pos/ui/utils';
import { ShieldAlert, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { AllergyDialog } from './allergy-dialog';
import { BackButton } from './back-button';
import type { Lookups } from './hooks';
import { PAYMENT_STATUS_STYLES } from './status';

/**
 * Who and where: order number (RF-C15), table, guests, waiter and channel. The allergies of the
 * table are one tap away, and once noted they stay in red under the header (DEC-037).
 */
export function OrderHeader({ order, lookups }: { order: OrderState; lookups: Lookups }) {
  const t = useTranslations('posOrder.order');
  const tc = useTranslations('posOrder.common');
  const tch = useTranslations('posOrder.channel');
  const tp = useTranslations('posOrder.paymentStatus');
  const tl = useTranslations('posOrder.allergy');
  const ta = useTranslations('posOrder.allergens');
  const [allergyOpen, setAllergyOpen] = useState(false);
  const editable = order.status === 'open';
  const allergyText = order.allergies
    ? [order.allergies.allergens.map((allergen) => ta(allergen)).join(', '), order.allergies.note]
        .filter(Boolean)
        .join(' · ')
    : null;
  const table = order.tableId ? lookups.tables.get(order.tableId) : undefined;
  const joined = order.joinedTableIds
    .map((id) => lookups.tables.get(id)?.label)
    .filter((label): label is string => Boolean(label));
  const waiter = lookups.users.get(order.waiterUserId)?.displayName ?? tc('unknownUser');

  return (
    <>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-card px-3 py-1.5 md:gap-x-4 md:gap-y-2 md:py-2">
        <BackButton variant="outline" short />
        {editable && (
          <Button
            variant="outline"
            className={cn(
              'order-last ml-auto gap-1.5 md:order-none',
              order.allergies && 'border-destructive text-destructive',
            )}
            onClick={() => setAllergyOpen(true)}
            aria-haspopup="dialog"
            data-testid="allergy-button"
          >
            <ShieldAlert /> {tl('button')}
          </Button>
        )}
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-lg font-bold md:text-xl">
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
        <div className="flex w-full flex-wrap items-center gap-2 text-sm max-md:text-xs md:w-auto">
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
      {allergyText && (
        <button
          type="button"
          role="alert"
          data-testid="order-allergy"
          disabled={!editable}
          onClick={() => setAllergyOpen(true)}
          className="flex min-h-11 w-full items-center gap-2 bg-destructive px-3 py-2 text-left font-semibold text-white disabled:opacity-100"
        >
          <ShieldAlert className="size-5 shrink-0" aria-hidden />
          <span className="min-w-0">{tl('banner', { list: allergyText })}</span>
        </button>
      )}
      <AllergyDialog order={order} open={allergyOpen} onClose={() => setAllergyOpen(false)} />
    </>
  );
}
