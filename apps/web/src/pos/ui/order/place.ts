'use client';

import type { OrderState } from '@pos/core';
import { useTranslations } from 'next-intl';
import type { Lookups } from './hooks';

/** Table (with its joined tables) or channel of an order, the way the staff calls it. */
export function usePlaceOf(lookups: Lookups) {
  const t = useTranslations('posOrder.common');
  const tc = useTranslations('posOrder.channel');
  return (order: Pick<OrderState, 'tableId' | 'joinedTableIds' | 'channel' | 'customerName'>) => {
    if (order.tableId) {
      const label = lookups.tables.get(order.tableId)?.label ?? '?';
      const joined = order.joinedTableIds
        .map((id) => lookups.tables.get(id)?.label)
        .filter((value): value is string => Boolean(value));
      return joined.length > 0
        ? t('tableJoined', { label, joined: joined.join(', ') })
        : t('table', { label });
    }
    const channel = tc(order.channel);
    return order.customerName ? `${channel} · ${order.customerName}` : channel;
  };
}
