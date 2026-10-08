'use client';

import { formatChf } from '@pos/core';
import { Button } from '@pos/ui/button';
import { cn } from '@pos/ui/utils';
import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { getPos } from '@/device/store';
import { usePosUi } from '../ui-store';
import { ActionBar } from './order/action-bar';
import { useLookups, useOrderData, useViewportFill } from './order/hooks';
import { LineDialog } from './order/line-dialog';
import { MoreDialog } from './order/more-dialog';
import { OpenTableDialog } from './order/open-table-dialog';
import { OrderHeader } from './order/order-header';
import { ProductPanel } from './order/product-panel';
import { Ticket } from './order/ticket';

type Pane = 'menu' | 'ticket';

/**
 * Taking an order (RF-C08…RF-C13, RF-C17): menu on the left, the ticket by course on the right
 * (one pane at a time on a phone), the next steps in the bar below. Everything is read from the
 * fold of operations, so the screen follows every action at once, offline too (RF-C18).
 */
export function OrderView({ orderId }: { orderId: string }) {
  // A fresh screen per order: dialogs and panes never carry over to the next one.
  return <OrderScreen key={orderId} orderId={orderId} />;
}

function OrderScreen({ orderId }: { orderId: string }) {
  const t = useTranslations('posOrder.order');
  const tc = useTranslations('posOrder.common');
  const navigate = usePosUi((state) => state.navigate);
  const data = useOrderData(orderId);
  const lookups = useLookups();
  const fill = useViewportFill<HTMLDivElement>();
  const [pane, setPane] = useState<Pane>('menu');
  const [lineId, setLineId] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [newOrderTable, setNewOrderTable] = useState<{ id: string; label: string } | null>(null);

  if (!data) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-muted-foreground">{t('notFound')}</p>
        <Button size="lg" onClick={() => navigate({ name: 'floor' })}>
          <ArrowLeft /> {t('backToFloor')}
        </Button>
      </div>
    );
  }

  const { order, items } = data;
  const editable = order.status === 'open';
  const validCount = items.filter((item) => item.prepStatus !== 'voided').length;
  const mergedInto = order.mergedIntoOrderId
    ? getPos().fold.orders.get(order.mergedIntoOrderId)
    : undefined;

  return (
    <div ref={fill.ref} style={fill.style} className="flex min-h-0 flex-col">
      <OrderHeader order={order} lookups={lookups} />

      {!editable && (
        <div
          className="flex flex-wrap items-center gap-3 border-b bg-amber-50 px-4 py-2 text-amber-950"
          role="status"
        >
          <span>
            {mergedInto
              ? t('mergedBanner', { number: mergedInto.displayNumber })
              : order.status === 'voided'
                ? t('voidedBanner')
                : t('closedBanner')}
          </span>
          {mergedInto ? (
            <Button
              variant="outline"
              onClick={() => navigate({ name: 'order', orderId: mergedInto.id })}
            >
              {tc('orderNumber', { number: mergedInto.displayNumber })}
            </Button>
          ) : (
            <Button variant="outline" onClick={() => navigate({ name: 'orders' })}>
              {t('toOrders')}
            </Button>
          )}
        </div>
      )}

      {editable && (
        <div
          className="grid shrink-0 grid-cols-2 gap-1 border-b bg-muted p-1 lg:hidden"
          role="tablist"
        >
          {(['menu', 'ticket'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={pane === value}
              onClick={() => setPane(value)}
              className={cn(
                'min-h-11 rounded-md px-3 text-base font-medium',
                pane === value ? 'bg-background shadow-sm' : 'text-muted-foreground',
              )}
            >
              {value === 'menu'
                ? t('menu')
                : t('ticketTab', { count: validCount, total: formatChf(order.totalRappen) })}
            </button>
          ))}
        </div>
      )}

      <div
        className={cn(
          // One bounded row: the menu and the ticket scroll on their own.
          'grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)]',
          editable && 'lg:grid-cols-[minmax(0,1fr)_minmax(22rem,28rem)]',
        )}
      >
        {editable && (
          <ProductPanel
            orderId={order.id}
            channel={order.channel}
            className={cn(pane !== 'menu' && 'hidden', 'lg:flex')}
          />
        )}
        <Ticket
          data={data}
          editable={editable}
          onLine={setLineId}
          className={cn('lg:border-l', editable && pane !== 'ticket' && 'hidden', 'lg:flex')}
        />
      </div>

      {editable && <ActionBar data={data} onMore={() => setMoreOpen(true)} />}

      <LineDialog data={data} itemId={lineId} onClose={() => setLineId(null)} />
      <MoreDialog
        data={data}
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        onNewOrderAtTable={() => {
          const table = order.tableId ? lookups.tables.get(order.tableId) : undefined;
          setMoreOpen(false);
          if (table) setNewOrderTable({ id: table.id, label: table.label });
        }}
      />
      <OpenTableDialog table={newOrderTable} onClose={() => setNewOrderTable(null)} />
    </div>
  );
}
