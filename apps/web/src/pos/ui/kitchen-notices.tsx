'use client';

import { itemsOf } from '@pos/core';
import { toast } from '@pos/ui/toaster';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { usePos } from '@/device/store';

/**
 * Tells the waiter when the kitchen has something ready for their orders (RF-C23): the KDS marks
 * it ready, the operation reaches this terminal and a notice says where to pick it up. Orders of
 * other waiters only change colour on the floor map.
 */
export function KitchenNotices() {
  const t = useTranslations('pos.kitchen');
  const fold = usePos((state) => state.fold);
  const foldVersion = usePos((state) => state.foldVersion);
  const userId = usePos((state) => state.user?.id);
  const tables = usePos((state) => state.bootstrap?.tables);
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    const ready = new Set<string>();
    for (const item of fold.items.values()) if (item.prepStatus === 'ready') ready.add(item.id);
    const before = seen.current;
    seen.current = ready;
    // The first look only learns what was ready already.
    if (!before || !userId) return;
    const orders = new Map<string, number>();
    for (const id of ready) {
      if (before.has(id)) continue;
      const item = fold.items.get(id)!;
      orders.set(item.orderId, (orders.get(item.orderId) ?? 0) + 1);
    }
    for (const [orderId, count] of orders) {
      const order = fold.orders.get(orderId);
      if (!order || order.waiterUserId !== userId || order.status !== 'open') continue;
      const table = tables?.find((t) => t.id === order.tableId)?.label;
      const remaining = itemsOf(fold, orderId).filter(
        (item) => item.prepStatus === 'sent' || item.prepStatus === 'preparing',
      ).length;
      toast.success(
        table
          ? t('readyTable', { table, count })
          : t('readyOrder', { number: order.displayNumber, count }),
        { description: remaining > 0 ? t('stillCooking', { count: remaining }) : undefined },
      );
    }
  }, [fold, foldVersion, userId, tables, t]);

  return null;
}
