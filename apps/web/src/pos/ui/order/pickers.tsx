'use client';

import { formatChf, type OrderItemState, type OrderState, tableViews } from '@pos/core';
import { cn } from '@pos/ui/utils';
import { useTranslations } from 'next-intl';
import { useId, useMemo } from 'react';
import { usePos } from '../../store';
import { byLabel } from './format';
import { type Lookups, useFoldMemo } from './hooks';
import { usePlaceOf } from './place';
import { TABLE_STATE_STYLES } from './status';
import { useLineNames } from './ticket';

/** Lines to move or split, with big tick boxes (RF-C12, RF-C13). */
export function ItemPicker({
  items,
  selected,
  onChange,
  label,
}: {
  items: OrderItemState[];
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  label: string;
}) {
  const tc = useTranslations('posOrder.common');
  const namesOf = useLineNames();
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      {items.map((item) => {
        const names = namesOf(item);
        const checked = selected.has(item.id);
        return (
          <label
            key={item.id}
            className={cn(
              'flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2',
              checked && 'border-primary bg-primary/5',
            )}
          >
            <input
              type="checkbox"
              className="size-5 shrink-0 accent-primary"
              checked={checked}
              onChange={(event) => {
                const next = new Set(selected);
                if (event.target.checked) next.add(item.id);
                else next.delete(item.id);
                onChange(next);
              }}
            />
            <span className="min-w-0 flex-1">
              {item.quantity}× {names.name}
              {names.variant && <span className="text-muted-foreground"> · {names.variant}</span>}
              {item.seat !== null && (
                <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs">
                  {tc('seat', { seat: item.seat })}
                </span>
              )}
            </span>
            <span className="shrink-0 tabular-nums">{formatChf(item.lineTotalRappen)}</span>
          </label>
        );
      })}
    </fieldset>
  );
}

/** Another open order as the target of a transfer or merge (RF-C13). */
export function OrderPicker({
  orders,
  selectedId,
  onSelect,
  lookups,
  label,
}: {
  orders: OrderState[];
  selectedId: string | null;
  onSelect: (orderId: string) => void;
  lookups: Lookups;
  label: string;
}) {
  const tc = useTranslations('posOrder.common');
  const placeOf = usePlaceOf(lookups);
  const labelId = useId();
  return (
    <div className="grid gap-2">
      <span className="text-sm font-medium" id={labelId}>
        {label}
      </span>
      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-labelledby={labelId}>
        {orders.map((order) => {
          const active = order.id === selectedId;
          return (
            <button
              key={order.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onSelect(order.id)}
              className={cn(
                'flex min-h-14 flex-col items-start rounded-lg border px-3 py-2 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                active ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent',
              )}
            >
              <span className="font-semibold">
                {placeOf(order)} · {order.displayNumber}
              </span>
              <span className="text-sm opacity-80">
                {lookups.users.get(order.waiterUserId)?.displayName ?? tc('unknownUser')} ·{' '}
                {formatChf(order.totalRappen)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Tables of the location by area, coloured by state, for moving or joining (RF-C03). */
export function TablePicker({
  selected,
  isDisabled,
  onToggle,
}: {
  selected: ReadonlySet<string>;
  isDisabled: (tableId: string) => boolean;
  onToggle: (tableId: string) => void;
}) {
  const t = useTranslations('posOrder.common');
  const ts = useTranslations('posOrder.tableState');
  const bootstrap = usePos((state) => state.bootstrap);
  const views = useFoldMemo((fold) => tableViews(fold));
  const areas = useMemo(
    () =>
      (bootstrap?.areas ?? [])
        .filter((area) => area.isActive)
        .map((area) => ({
          area,
          tables: (bootstrap?.tables ?? [])
            .filter((table) => table.areaId === area.id && table.isActive)
            .sort(byLabel),
        }))
        .filter((entry) => entry.tables.length > 0),
    [bootstrap],
  );
  return (
    <div className="grid gap-4">
      {areas.map(({ area, tables }) => (
        <section key={area.id} className="grid gap-2" aria-label={area.name}>
          <h3 className="text-sm font-medium">{area.name}</h3>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-2">
            {tables.map((table) => {
              const state = views.get(table.id)?.state ?? 'free';
              const active = selected.has(table.id);
              return (
                <button
                  key={table.id}
                  type="button"
                  aria-pressed={active}
                  aria-label={t('table', { label: table.label })}
                  disabled={isDisabled(table.id)}
                  onClick={() => onToggle(table.id)}
                  className={cn(
                    'flex min-h-16 flex-col items-start justify-between rounded-lg border-2 p-2 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-40',
                    TABLE_STATE_STYLES[state],
                    active && 'ring-4 ring-primary',
                  )}
                >
                  <span className="text-lg leading-none font-bold">{table.label}</span>
                  <span className="text-xs">{ts(state)}</span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
