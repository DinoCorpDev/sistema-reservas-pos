'use client';

import { toast } from '@pos/ui/toaster';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { usePos } from '@/device/store';

/**
 * Tells the waiter of a table when someone else added to it (DEC-039): with open tables any
 * colleague may take an order there, and the table's waiter should know before asking the guests
 * again. Lines already there when the screen opened are only learnt, never announced.
 */
export function TableNotices() {
  const t = useTranslations('posOrder.ownership');
  const fold = usePos((state) => state.fold);
  const foldVersion = usePos((state) => state.foldVersion);
  const userId = usePos((state) => state.user?.id);
  const users = usePos((state) => state.bootstrap?.users);
  const tables = usePos((state) => state.bootstrap?.tables);
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    const all = new Set(fold.items.keys());
    const before = seen.current;
    seen.current = all;
    if (!before || !userId) return;
    // New lines by someone else on my open table orders, per order and person.
    const added = new Map<string, { orderId: string; by: string; count: number }>();
    for (const id of all) {
      if (before.has(id)) continue;
      const item = fold.items.get(id)!;
      if (item.addedByUserId === userId || item.prepStatus === 'voided') continue;
      const order = fold.orders.get(item.orderId);
      if (!order || order.waiterUserId !== userId || order.status !== 'open' || !order.tableId) {
        continue;
      }
      const key = `${order.id}:${item.addedByUserId}`;
      const entry = added.get(key) ?? { orderId: order.id, by: item.addedByUserId, count: 0 };
      entry.count += item.quantity;
      added.set(key, entry);
    }
    for (const { orderId, by, count } of added.values()) {
      const order = fold.orders.get(orderId)!;
      toast.info(
        t('addedByOther', {
          name: users?.find((u) => u.id === by)?.displayName ?? '?',
          count,
          table: tables?.find((table) => table.id === order.tableId)?.label ?? '?',
        }),
      );
    }
  }, [fold, foldVersion, userId, users, tables, t]);

  return null;
}
