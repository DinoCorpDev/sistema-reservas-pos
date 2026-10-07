'use client';

import { Button } from '@pos/ui/button';
import { CreditCard, Ellipsis, HandPlatter, PackageCheck, Send } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { sendItems, serveItems } from '../../actions';
import { usePosUi } from '../../ui-store';
import type { OrderData } from './hooks';
import { useRunner } from './run';

/** Bar and take-away orders are handed over at the counter and may be paid first (RF-C17). */
export const isCounterOrder = (order: OrderData['order']) =>
  order.channel !== 'table' && order.tableId === null;

/**
 * What the waiter does next: send what is pending, march a held course (RF-C09), mark served or
 * handed over (RF-C17), pay, and everything else under "Mehr".
 */
export function ActionBar({ data, onMore }: { data: OrderData; onMore: () => void }) {
  const t = useTranslations('posOrder.actions');
  const navigate = usePosUi((state) => state.navigate);
  const run = useRunner();
  const [busy, setBusy] = useState(false);
  const { order, items } = data;
  const counter = isCounterOrder(order);

  const valid = items.filter((item) => item.prepStatus !== 'voided');
  const pending = valid.filter((item) => item.prepStatus === 'pending');
  const inKitchen = valid.filter(
    (item) =>
      item.prepStatus === 'sent' || item.prepStatus === 'preparing' || item.prepStatus === 'ready',
  );
  const notServed = valid.filter((item) => item.prepStatus !== 'served');
  const pendingCourses = [...new Set(pending.map((item) => item.course))].sort((a, b) => a - b);
  const sentCourses = new Set(
    valid.filter((item) => item.prepStatus !== 'pending').map((item) => item.course),
  );
  // A course can be sent on its own when another one is held back or already went out.
  const marchable = pendingCourses.filter(
    (course) => pendingCourses.length > 1 || [...sentCourses].some((sent) => sent !== course),
  );
  // At a table the kitchen gets everything before the bill; at the counter, prepaying is fine.
  const canPay = order.balanceRappen > 0 && (counter || pending.length === 0);

  async function act(task: () => Promise<unknown>) {
    setBusy(true);
    await run(task);
    setBusy(false);
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t bg-card p-2">
      <Button
        size="lg"
        variant="outline"
        className="mr-auto"
        aria-haspopup="dialog"
        onClick={onMore}
      >
        <Ellipsis /> {t('more')}
      </Button>
      {marchable.map((course) => (
        <Button
          key={course}
          size="lg"
          variant="secondary"
          disabled={busy}
          onClick={() => void act(() => sendItems(order.id, course))}
        >
          {t('sendCourse', { course })}
        </Button>
      ))}
      <Button
        size="lg"
        disabled={busy || pending.length === 0}
        onClick={() => void act(() => sendItems(order.id))}
      >
        <Send /> {t('send')}
      </Button>
      {counter ? (
        <Button
          size="lg"
          variant="outline"
          disabled={busy || notServed.length === 0}
          onClick={() => void act(() => serveItems(order.id))}
        >
          <PackageCheck /> {t('handedOver')}
        </Button>
      ) : (
        <Button
          size="lg"
          variant="outline"
          disabled={busy || inKitchen.length === 0}
          onClick={() =>
            void act(() =>
              serveItems(
                order.id,
                inKitchen.map((item) => item.id),
              ),
            )
          }
        >
          <HandPlatter /> {t('served')}
        </Button>
      )}
      <Button
        size="lg"
        variant="default"
        className="bg-emerald-700 hover:bg-emerald-700/90 active:bg-emerald-700/80"
        disabled={!canPay}
        title={!counter && pending.length > 0 ? t('sendFirst') : undefined}
        onClick={() => navigate({ name: 'payment', orderId: order.id })}
      >
        <CreditCard /> {t('pay')}
      </Button>
    </div>
  );
}
