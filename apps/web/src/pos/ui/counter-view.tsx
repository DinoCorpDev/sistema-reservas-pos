'use client';

import { type OrderState, orderTableState, serviceGroupOf, type TableState } from '@pos/core';
import { formatPosMoney } from '@/pos/money';
import { cn } from '@pos/ui/utils';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { openOrder } from '../actions';
import { usePosUi } from '../ui-store';
import { minutesSince } from './order/format';
import { useFoldMemo, useLookups, useNow } from './order/hooks';
import { useRunner } from './order/run';
import { TABLE_STATE_STYLES } from './order/status';

type CounterChannel = 'bar' | 'takeaway';

/**
 * The bar or the take-away counter (RF-C17, DEC-034): the open orders of that kind, ready ones
 * first, and one big button to open a new order, so nothing is opened by a stray tap and the
 * waiter sees what is already running before starting another one.
 */
export function CounterView({ channel }: { channel: CounterChannel }) {
  const t = useTranslations('pos.counter');
  const ts = useTranslations('pos.shell');
  const tt = useTranslations('posOrder.tableState');
  const tc = useTranslations('posOrder.common');
  const navigate = usePosUi((state) => state.navigate);
  const run = useRunner();
  const lookups = useLookups();
  const now = useNow();
  const [opening, setOpening] = useState(false);

  const orders = useFoldMemo(
    (fold) =>
      [...fold.orders.values()]
        .filter((order) => order.status === 'open' && serviceGroupOf(order) === channel)
        .map((order) => ({ order: { ...order }, state: orderTableState(fold, order) }))
        .sort(
          (a, b) =>
            Number(b.state === 'ready') - Number(a.state === 'ready') ||
            a.order.openedAt.localeCompare(b.order.openedAt),
        ),
    [channel],
  );

  async function openNew() {
    if (opening) return;
    setOpening(true);
    const result = await run(() => openOrder({ channel }));
    setOpening(false);
    if (result.ok) navigate({ name: 'order', orderId: result.value });
  }

  return (
    <div className="flex flex-1 flex-col gap-3 p-3 sm:p-4">
      <h1 className="text-xl font-semibold">
        {ts(channel)}{' '}
        <span className="text-base font-normal text-muted-foreground">
          {t('openCount', { count: orders.length })}
        </span>
      </h1>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        <li>
          <button
            type="button"
            disabled={opening}
            onClick={() => void openNew()}
            className="flex min-h-32 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary/50 bg-primary/5 p-4 text-lg font-semibold text-primary transition-colors outline-none hover:bg-primary/10 focus-visible:ring-[3px] focus-visible:ring-ring/50 active:bg-primary/15 disabled:opacity-60"
          >
            <Plus className="size-10" aria-hidden />
            {t('newOrder')}
          </button>
        </li>
        {orders.map(({ order, state }) => (
          <li key={order.id}>
            <CounterOrderCard
              order={order}
              state={state}
              stateLabel={tt(state)}
              waiter={lookups.users.get(order.waiterUserId)?.displayName ?? tc('unknownUser')}
              minutes={minutesSince(order.lastSentAt, now)}
              minutesLabel={(minutes) => tc('minutes', { minutes })}
              onSelect={() => navigate({ name: 'order', orderId: order.id })}
            />
          </li>
        ))}
      </ul>
      {orders.length === 0 && (
        <p className="p-4 text-center text-muted-foreground">
          {channel === 'bar' ? t('emptyBar') : t('emptyTakeaway')}
        </p>
      )}
    </div>
  );
}

function CounterOrderCard({
  order,
  state,
  stateLabel,
  waiter,
  minutes,
  minutesLabel,
  onSelect,
}: {
  order: OrderState;
  state: TableState;
  stateLabel: string;
  waiter: string;
  minutes: number | null;
  minutesLabel: (minutes: number) => string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      data-testid="counter-order"
      data-order-id={order.id}
      data-state={state}
      onClick={onSelect}
      className={cn(
        'flex min-h-32 w-full flex-col justify-between gap-2 rounded-xl border-2 p-3 text-left shadow-xs transition-transform outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.98]',
        TABLE_STATE_STYLES[state],
      )}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="font-mono text-2xl font-bold">{order.displayNumber}</span>
        <span className="rounded-full bg-background/70 px-2 py-0.5 text-sm font-medium">
          {stateLabel}
        </span>
      </span>
      {order.customerName && (
        <span className="truncate text-base font-medium">{order.customerName}</span>
      )}
      <span className="flex items-end justify-between gap-2 text-sm">
        <span className="truncate">{waiter}</span>
        <span className="shrink-0 text-right tabular-nums">
          <span className="block text-base font-semibold">{formatPosMoney(order.totalRappen)}</span>
          {minutes !== null && <span className="opacity-80">{minutesLabel(minutes)}</span>}
        </span>
      </span>
    </button>
  );
}
