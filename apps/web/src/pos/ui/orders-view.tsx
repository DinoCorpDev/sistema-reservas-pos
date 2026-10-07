'use client';

import { formatChf, type OrderState } from '@pos/core';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@pos/ui/tabs';
import { cn } from '@pos/ui/utils';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { currentBusinessDate } from '../numbers';
import { usePos } from '../store';
import { usePosUi } from '../ui-store';
import { minutesSince } from './order/format';
import { type Lookups, useFoldMemo, useLookups, useNow } from './order/hooks';
import { usePlaceOf } from './order/place';
import { PAYMENT_STATUS_STYLES } from './order/status';
import { ClosedOrderPanel } from './payment/closed-order-panel';

type Tab = 'mine' | 'open' | 'closed';

/** One row per order: number, place, waiter, total, balance and minutes (stacked on phones). */
const COLUMNS =
  'grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 sm:grid-cols-[5rem_minmax(0,1.2fr)_minmax(0,1fr)_7rem_7rem_6rem]';
const ROW =
  'min-h-14 w-full rounded-xl border bg-card px-3 py-2 text-left shadow-xs transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 active:bg-accent/80';
const SECOND_LINE = 'sm:col-start-auto sm:row-start-auto';

/**
 * Orders at a glance (RF-C19): the waiter's own tables, every open order for the manager, with
 * the minutes since the last send, and the orders closed today, where receipts, refunds and
 * reopening live.
 */
export function OrdersView() {
  const t = useTranslations('posOrder.orders');
  const userId = usePos((state) => state.user?.id);
  const navigate = usePosUi((state) => state.navigate);
  const lookups = useLookups();
  const now = useNow();
  const [tab, setTab] = useState<Tab>('mine');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const placeOf = usePlaceOf(lookups);

  // The business day changes at night (04:00 by default), not at midnight; `now` re-renders.
  const today = currentBusinessDate();
  const lists = useFoldMemo(
    (fold) => {
      const open: OrderState[] = [];
      const closed: OrderState[] = [];
      for (const order of fold.orders.values()) {
        if (order.status === 'open') open.push({ ...order });
        // A merged order lives on in the order that absorbed it.
        else if (order.businessDate === today && order.mergedIntoOrderId === null) {
          closed.push({ ...order });
        }
      }
      open.sort((a, b) => a.openedAt.localeCompare(b.openedAt));
      const endOf = (order: OrderState) => order.closedAt ?? order.voidedAt ?? order.updatedAt;
      closed.sort((a, b) => endOf(b).localeCompare(endOf(a)));
      return { open, closed, mine: open.filter((order) => order.waiterUserId === userId) };
    },
    [today, userId],
  );
  const selected = lists.closed.find((order) => order.id === selectedId) ?? null;
  const openOrder = (orderId: string) => navigate({ name: 'order', orderId });

  const counts: Record<Tab, number> = {
    mine: lists.mine.length,
    open: lists.open.length,
    closed: lists.closed.length,
  };
  return (
    <div className="flex flex-1 flex-col p-3 sm:p-4">
      <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
        <TabsList aria-label={t('title')}>
          {(['mine', 'open', 'closed'] as const).map((key) => (
            <TabsTrigger key={key} value={key} className="text-base">
              {t(key)}
              <span className="rounded-full bg-background/70 px-2 text-xs tabular-nums" aria-hidden>
                {counts[key]}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="mine">
          <OpenOrderList
            orders={lists.mine}
            empty={t('emptyMine')}
            lookups={lookups}
            now={now}
            onSelect={openOrder}
          />
        </TabsContent>
        <TabsContent value="open">
          <OpenOrderList
            orders={lists.open}
            empty={t('emptyOpen')}
            lookups={lookups}
            now={now}
            onSelect={openOrder}
          />
        </TabsContent>
        <TabsContent value="closed">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,28rem)]">
            <ClosedOrderList
              orders={lists.closed}
              selectedId={selected?.id ?? null}
              lookups={lookups}
              onSelect={setSelectedId}
            />
            <section
              className="rounded-xl border bg-card p-4 lg:sticky lg:top-4 lg:self-start"
              aria-label={t('details')}
            >
              {selected ? (
                <div className="grid gap-3">
                  <h2 className="text-lg font-semibold">
                    {t('orderTitle', { number: selected.displayNumber, place: placeOf(selected) })}
                  </h2>
                  <ClosedOrderPanel orderId={selected.id} />
                </div>
              ) : (
                <p className="text-muted-foreground">{t('selectClosed')}</p>
              )}
            </section>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function HeaderRow({ last }: { last: string }) {
  const t = useTranslations('posOrder.orders');
  return (
    <div
      className={cn(COLUMNS, 'hidden px-3 pb-1 text-xs font-medium text-muted-foreground sm:grid')}
      aria-hidden
    >
      <span>{t('number')}</span>
      <span>{t('place')}</span>
      <span>{t('waiter')}</span>
      <span className="text-right">{t('total')}</span>
      <span className="text-right">{t('balance')}</span>
      <span className="text-right">{last}</span>
    </div>
  );
}

function OpenOrderList({
  orders,
  empty,
  lookups,
  now,
  onSelect,
}: {
  orders: OrderState[];
  empty: string;
  lookups: Lookups;
  now: number;
  onSelect: (orderId: string) => void;
}) {
  const t = useTranslations('posOrder.orders');
  const tp = useTranslations('posOrder.paymentStatus');
  const tc = useTranslations('posOrder.common');
  const placeOf = usePlaceOf(lookups);
  if (orders.length === 0) return <p className="p-6 text-center text-muted-foreground">{empty}</p>;
  return (
    <div>
      <HeaderRow last={t('sinceSent')} />
      <ul className="grid gap-2">
        {orders.map((order) => {
          const minutes = minutesSince(order.lastSentAt, now);
          return (
            <li key={order.id}>
              <button
                type="button"
                data-testid="order-row"
                data-order-id={order.id}
                onClick={() => onSelect(order.id)}
                className={cn(COLUMNS, ROW)}
              >
                <span className="font-mono text-lg font-semibold">{order.displayNumber}</span>
                <span className="truncate font-medium">
                  {placeOf(order)}
                  {order.paymentStatus === 'partial' && (
                    <span
                      className={cn(
                        'ml-2 rounded px-1.5 py-0.5 text-xs',
                        PAYMENT_STATUS_STYLES.partial,
                      )}
                    >
                      {tp('partial')}
                    </span>
                  )}
                </span>
                <span
                  className={cn(
                    'col-start-2 row-start-2 truncate text-sm text-muted-foreground sm:text-base sm:text-foreground',
                    SECOND_LINE,
                  )}
                >
                  {lookups.users.get(order.waiterUserId)?.displayName ?? tc('unknownUser')}
                </span>
                <span
                  className={cn(
                    'col-start-3 row-start-1 text-right font-semibold tabular-nums sm:font-normal',
                    SECOND_LINE,
                  )}
                >
                  {formatChf(order.totalRappen)}
                </span>
                <span
                  className={cn(
                    'col-start-3 row-start-2 text-right text-sm tabular-nums sm:text-base',
                    SECOND_LINE,
                  )}
                >
                  <span className="sm:hidden">{t('balanceShort')} </span>
                  {formatChf(order.balanceRappen)}
                </span>
                <span
                  className={cn(
                    'col-start-1 row-start-2 text-sm text-muted-foreground tabular-nums sm:text-right sm:text-base',
                    SECOND_LINE,
                  )}
                >
                  {minutes === null ? '–' : tc('minutes', { minutes })}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ClosedOrderList({
  orders,
  selectedId,
  lookups,
  onSelect,
}: {
  orders: OrderState[];
  selectedId: string | null;
  lookups: Lookups;
  onSelect: (orderId: string) => void;
}) {
  const t = useTranslations('posOrder.orders');
  const to = useTranslations('posOrder.orderStatus');
  const tc = useTranslations('posOrder.common');
  const format = useFormatter();
  const placeOf = usePlaceOf(lookups);
  if (orders.length === 0) {
    return <p className="p-6 text-center text-muted-foreground">{t('emptyClosed')}</p>;
  }
  return (
    <div>
      <HeaderRow last={t('closedAt')} />
      <ul className="grid gap-2">
        {orders.map((order) => {
          const end = order.closedAt ?? order.voidedAt;
          const active = order.id === selectedId;
          return (
            <li key={order.id}>
              <button
                type="button"
                data-testid="closed-order-row"
                data-order-id={order.id}
                aria-pressed={active}
                onClick={() => onSelect(order.id)}
                className={cn(COLUMNS, ROW, active && 'border-primary ring-2 ring-primary/30')}
              >
                <span className="font-mono text-lg font-semibold">{order.displayNumber}</span>
                <span className="truncate font-medium">{placeOf(order)}</span>
                <span
                  className={cn(
                    'col-start-2 row-start-2 truncate text-sm text-muted-foreground sm:text-base sm:text-foreground',
                    SECOND_LINE,
                  )}
                >
                  {lookups.users.get(order.waiterUserId)?.displayName ?? tc('unknownUser')}
                </span>
                <span
                  className={cn(
                    'col-start-3 row-start-1 text-right font-semibold tabular-nums sm:font-normal',
                    SECOND_LINE,
                  )}
                >
                  {formatChf(order.totalRappen)}
                </span>
                <span
                  className={cn(
                    'col-start-3 row-start-2 justify-self-end rounded px-1.5 py-0.5 text-xs',
                    SECOND_LINE,
                    order.status === 'voided'
                      ? 'bg-destructive/15 text-destructive'
                      : PAYMENT_STATUS_STYLES[order.paymentStatus],
                  )}
                >
                  {to(order.status)}
                </span>
                <span
                  className={cn(
                    'col-start-1 row-start-2 text-sm text-muted-foreground tabular-nums sm:text-right sm:text-base',
                    SECOND_LINE,
                  )}
                >
                  {end
                    ? format.dateTime(new Date(end), { hour: '2-digit', minute: '2-digit' })
                    : '–'}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
