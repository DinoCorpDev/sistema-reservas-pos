'use client';

import type { OrderState } from '@pos/core';
import { Button } from '@pos/ui/button';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { updateOrder } from '../../actions';
import { useFoldMemo } from './hooks';
import { TablePicker } from './pickers';
import { useRunner } from './run';

/** Most tables an order can join (`order.update` accepts up to 10). */
const MAX_JOINED = 10;

/** Tables used by the other open orders: as their own table and/or joined to them. */
function useTablesOfOthers(orderId: string) {
  return useFoldMemo(
    (fold) => {
      const main = new Set<string>();
      const joined = new Set<string>();
      for (const other of fold.orders.values()) {
        if (other.status !== 'open' || other.id === orderId) continue;
        if (other.tableId) main.add(other.tableId);
        for (const id of other.joinedTableIds) joined.add(id);
      }
      return { main, joined };
    },
    [orderId],
  );
}

/** Moves the bill to another table, without losing items or payments (RF-C03). */
export function MoveTablePanel({ order, onDone }: { order: OrderState; onDone: () => void }) {
  const t = useTranslations('posOrder.more');
  const run = useRunner();
  const others = useTablesOfOthers(order.id);
  const [busy, setBusy] = useState(false);

  async function move(tableId: string) {
    if (busy || tableId === order.tableId) return;
    setBusy(true);
    const joined = order.joinedTableIds.filter((id) => id !== tableId);
    const result = await run(() =>
      updateOrder(
        order.id,
        joined.length === order.joinedTableIds.length
          ? { tableId }
          : { tableId, joinedTableIds: joined },
      ),
    );
    setBusy(false);
    if (result.ok) onDone();
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">{t('moveDescription')}</p>
      <TablePicker
        selected={new Set(order.tableId ? [order.tableId] : [])}
        // A table joined to another order belongs to that order; another group's own table is
        // fine: several orders can share a table (RF-C05).
        isDisabled={(id) => busy || id === order.tableId || others.joined.has(id)}
        onToggle={(id) => void move(id)}
      />
    </div>
  );
}

/** Joins tables to this order's table, or separates them again (RF-C03). */
export function JoinTablesPanel({ order, onDone }: { order: OrderState; onDone: () => void }) {
  const t = useTranslations('posOrder.more');
  const tc = useTranslations('posOrder.common');
  const run = useRunner();
  const others = useTablesOfOthers(order.id);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(order.joinedTableIds));
  const [busy, setBusy] = useState(false);

  function toggle(tableId: string) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(tableId)) next.delete(tableId);
      else if (next.size < MAX_JOINED) next.add(tableId);
      return next;
    });
  }

  async function save() {
    setBusy(true);
    const result = await run(() => updateOrder(order.id, { joinedTableIds: [...selected] }));
    setBusy(false);
    if (result.ok) onDone();
  }

  const unchanged =
    selected.size === order.joinedTableIds.length &&
    order.joinedTableIds.every((id) => selected.has(id));
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">{t('joinDescription')}</p>
      <TablePicker
        selected={selected}
        isDisabled={(id) =>
          id === order.tableId ||
          (!selected.has(id) &&
            (others.main.has(id) || others.joined.has(id) || selected.size >= MAX_JOINED))
        }
        onToggle={toggle}
      />
      <Button size="lg" disabled={busy || unchanged} onClick={() => void save()}>
        {tc('save')}
      </Button>
    </div>
  );
}
