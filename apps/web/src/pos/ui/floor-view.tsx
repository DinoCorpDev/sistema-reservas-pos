'use client';

import type { BootstrapDto } from '@pos/api';
import { type TableState, tableViews, type TableView } from '@pos/core';
import { formatPosMoney } from '@/pos/money';
import { Button } from '@pos/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@pos/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@pos/ui/tabs';
import { cn } from '@pos/ui/utils';
import { EmptyState } from '@pos/ui/empty-state';
import { Armchair, Clock, Link2, Plus, ShieldAlert, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type CSSProperties, useId, useMemo, useState } from 'react';
import { getPos, usePos } from '@/device/store';
import { usePosUi } from '../ui-store';
import { byLabel, minutesSince } from './order/format';
import { useElementWidth, useFoldMemo, useLookups, useNow } from './order/hooks';
import { OpenTableDialog } from './order/open-table-dialog';
import { LEGEND_STATES, TABLE_STATE_ICONS, TABLE_STATE_STYLES } from './order/status';

type FloorTable = BootstrapDto['tables'][number];

/** The map scales to the container; below this cell width it becomes a plain grid. */
const MIN_CELL_PX = 76;
const MAX_GRID = 16;

/** Area of the floor shown last on this terminal, kept while the POS runs. */
let lastAreaId: string | null = null;

/**
 * Table map by area (RF-C01): the state of each table is derived from its open orders, with the
 * guests and the minutes since the last send (RF-C19). A free table opens with its guests
 * (RF-C02); an occupied one opens its order, or lets the waiter choose when several groups pay
 * separately (RF-C05). Derived data is computed once per change of the orders (RNF-06).
 */
export function FloorView() {
  const t = useTranslations('posOrder.floor');
  const ts = useTranslations('posOrder.tableState');
  const bootstrap = usePos((state) => state.bootstrap);
  const navigate = usePosUi((state) => state.navigate);
  const now = useNow();
  const [areaId, setAreaId] = useState(lastAreaId);
  const [opening, setOpening] = useState<FloorTable | null>(null);
  const [choosing, setChoosing] = useState<{ table: FloorTable; orderIds: string[] } | null>(null);

  const floor = useFoldMemo((fold) => {
    const views = tableViews(fold);
    const guests = new Map<string, number>();
    // Tables where a guest is allergic (DEC-037): the waiter sees it before opening the order.
    const allergy = new Set<string>();
    for (const order of fold.orders.values()) {
      if (order.status !== 'open' || order.tableId === null) continue;
      guests.set(order.tableId, (guests.get(order.tableId) ?? 0) + (order.guestCount ?? 0));
      if (order.allergies) allergy.add(order.tableId);
    }
    return { views, guests, allergy };
  });

  const areas = useMemo(() => {
    const tables = bootstrap?.tables ?? [];
    return (bootstrap?.areas ?? [])
      .map((area) => ({
        area,
        // A deactivated table (or area) still shows while it has an open order.
        tables: tables
          .filter(
            (table) => table.areaId === area.id && (table.isActive || floor.views.has(table.id)),
          )
          .sort(byLabel),
      }))
      .filter(
        ({ area, tables }) =>
          tables.length > 0 && (area.isActive || tables.some((table) => floor.views.has(table.id))),
      );
  }, [bootstrap, floor.views]);

  const tableById = useMemo(
    () => new Map((bootstrap?.tables ?? []).map((table) => [table.id, table])),
    [bootstrap],
  );
  const current = areas.find((entry) => entry.area.id === areaId) ?? areas[0];

  function select(table: FloorTable) {
    const view = floor.views.get(table.id);
    if (!view || view.orderIds.length === 0) {
      setOpening(table);
      return;
    }
    if (view.orderIds.length === 1) {
      navigate({ name: 'order', orderId: view.orderIds[0]! });
      return;
    }
    setChoosing({ table, orderIds: view.orderIds });
  }

  function newOrderAt(table: FloorTable) {
    // A new group at a joined table sits at the main table.
    const mainId = floor.views.get(table.id)?.joinedToTableId;
    setChoosing(null);
    setOpening((mainId && tableById.get(mainId)) || table);
  }

  if (!current) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <EmptyState icon={<Armchair />} title={t('empty')} />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-3 p-3 sm:p-4">
      <Tabs
        value={current.area.id}
        onValueChange={(value) => {
          lastAreaId = value;
          setAreaId(value);
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList aria-label={t('areas')} className="rounded-full">
            {areas.map(({ area, tables }) => {
              // How many tables of the area are taken, beside its name (not part of its name).
              const busy = tables.filter(
                (table) => (floor.views.get(table.id)?.state ?? 'free') !== 'free',
              ).length;
              return (
                <TabsTrigger
                  key={area.id}
                  value={area.id}
                  className="min-w-24 rounded-full text-base"
                >
                  {area.name}
                  {busy > 0 ? (
                    <span
                      aria-hidden
                      className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand-strong tabular-nums"
                    >
                      {busy}
                    </span>
                  ) : null}
                </TabsTrigger>
              );
            })}
          </TabsList>
          <ul className="flex flex-wrap gap-1.5 text-xs" aria-label={t('legend')}>
            {LEGEND_STATES.map((state) => (
              <li
                key={state}
                className="flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 font-medium"
              >
                <span
                  className={cn('size-3 rounded-full border-2', TABLE_STATE_STYLES[state])}
                  aria-hidden
                />
                {ts(state)}
              </li>
            ))}
          </ul>
        </div>
        {areas.map(({ area, tables }) => (
          <TabsContent key={area.id} value={area.id}>
            <AreaMap
              tables={tables}
              views={floor.views}
              guests={floor.guests}
              allergy={floor.allergy}
              tableById={tableById}
              now={now}
              onSelect={select}
            />
          </TabsContent>
        ))}
      </Tabs>

      <OpenTableDialog table={opening} onClose={() => setOpening(null)} />
      <ChooseOrderDialog
        choice={choosing}
        onClose={() => setChoosing(null)}
        onOpen={(orderId) => {
          setChoosing(null);
          navigate({ name: 'order', orderId });
        }}
        onNew={newOrderAt}
      />
    </div>
  );
}

/** Grid placement of every table when the area has a usable layout; null = plain grid. */
function planLayout(tables: readonly FloorTable[]) {
  if (tables.length < 2) return null;
  let cols = 0;
  let rows = 0;
  for (const table of tables) {
    cols = Math.max(cols, table.posX + table.width);
    rows = Math.max(rows, table.posY + table.height);
  }
  if (cols > MAX_GRID || rows > MAX_GRID) return null;
  // Tables never placed (all at 0,0) or placed on top of each other: no usable layout.
  for (let i = 0; i < tables.length; i += 1) {
    for (let j = i + 1; j < tables.length; j += 1) {
      const a = tables[i]!;
      const b = tables[j]!;
      const overlap =
        a.posX < b.posX + b.width &&
        b.posX < a.posX + a.width &&
        a.posY < b.posY + b.height &&
        b.posY < a.posY + a.height;
      if (overlap) return null;
    }
  }
  return { cols: Math.max(cols, 4), rows };
}

function AreaMap({
  tables,
  views,
  guests,
  allergy,
  tableById,
  now,
  onSelect,
}: {
  tables: FloorTable[];
  views: Map<string, TableView>;
  guests: Map<string, number>;
  allergy: Set<string>;
  tableById: Map<string, FloorTable>;
  now: number;
  onSelect: (table: FloorTable) => void;
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const layout = useMemo(() => planLayout(tables), [tables]);
  const positioned = layout !== null && width / layout.cols >= MIN_CELL_PX;
  return (
    <div
      ref={ref}
      className={cn(
        'grid gap-2 sm:gap-3',
        // Three tables per row on a phone held upright (DEC-036), more on a tablet.
        !positioned &&
          'auto-rows-[minmax(6.5rem,auto)] grid-cols-[repeat(auto-fill,minmax(6.75rem,1fr))] sm:auto-rows-[minmax(7.5rem,auto)] sm:grid-cols-[repeat(auto-fill,minmax(9rem,1fr))]',
      )}
      style={
        positioned
          ? {
              gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${layout.rows}, minmax(7rem, auto))`,
            }
          : undefined
      }
    >
      {tables.map((table) => {
        const view = views.get(table.id);
        const joinedTo = view?.joinedToTableId ? tableById.get(view.joinedToTableId) : undefined;
        return (
          <TableTile
            key={table.id}
            table={table}
            state={view?.state ?? 'free'}
            orderCount={joinedTo ? 0 : (view?.orderIds.length ?? 0)}
            guests={joinedTo ? 0 : (guests.get(table.id) ?? 0)}
            allergy={!joinedTo && allergy.has(table.id)}
            minutes={minutesSince(view?.lastSentAt ?? null, now)}
            joinedToLabel={joinedTo?.label ?? null}
            style={
              positioned
                ? {
                    gridColumn: `${table.posX + 1} / span ${table.width}`,
                    gridRow: `${table.posY + 1} / span ${table.height}`,
                  }
                : undefined
            }
            onSelect={() => onSelect(table)}
          />
        );
      })}
    </div>
  );
}

function TableTile({
  table,
  state,
  orderCount,
  guests,
  allergy,
  minutes,
  joinedToLabel,
  style,
  onSelect,
}: {
  table: FloorTable;
  state: TableState;
  orderCount: number;
  guests: number;
  /** A guest at the table is allergic (DEC-037). */
  allergy: boolean;
  minutes: number | null;
  joinedToLabel: string | null;
  style?: CSSProperties;
  onSelect: () => void;
}) {
  const t = useTranslations('posOrder.floor');
  const ts = useTranslations('posOrder.tableState');
  const tc = useTranslations('posOrder.common');
  const detailsId = useId();
  const StateIcon = joinedToLabel ? Link2 : TABLE_STATE_ICONS[state];
  return (
    <button
      type="button"
      data-testid={`table-${table.label}`}
      data-state={state}
      aria-label={t('table', { label: table.label })}
      aria-describedby={detailsId}
      onClick={onSelect}
      style={style}
      className={cn(
        'flex min-h-26 min-w-0 flex-col justify-between gap-2 border-2 p-3 text-left shadow-card transition-[transform,box-shadow] duration-150 select-none hover:shadow-raised active:scale-[0.97]',
        'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        table.shape === 'round' ? 'rounded-[1.75rem] px-4' : 'rounded-2xl',
        TABLE_STATE_STYLES[state],
      )}
    >
      <span className="flex items-start justify-between gap-1">
        <span className="font-brand text-3xl leading-none font-semibold">{table.label}</span>
        <span className="flex items-center gap-1">
          {orderCount > 1 && (
            <span className="rounded-full bg-black/10 px-2 py-0.5 text-xs font-semibold dark:bg-white/15">
              ×{orderCount}
            </span>
          )}
          {allergy ? (
            <span
              className="grid size-8 place-items-center rounded-full bg-destructive text-white shadow-sm"
              data-testid="table-allergy"
            >
              <ShieldAlert className="size-4" aria-hidden />
              <span className="sr-only">{t('allergy')}</span>
            </span>
          ) : (
            <span
              aria-hidden
              className="grid size-8 place-items-center rounded-full bg-black/5 dark:bg-white/10"
            >
              <StateIcon className="size-4" />
            </span>
          )}
        </span>
      </span>
      <span id={detailsId} className="flex min-w-0 flex-col gap-1.5">
        {/* Two lines on a narrow phone tile rather than a cut word. */}
        <span className="line-clamp-2 text-sm leading-tight font-semibold">
          {joinedToLabel ? t('joinedTo', { label: joinedToLabel }) : ts(state)}
        </span>
        {(guests > 0 || minutes !== null) && (
          <span className="flex flex-wrap items-center gap-1.5 text-xs font-medium">
            {guests > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-black/5 px-2 py-0.5 dark:bg-white/10">
                <Users className="size-3.5" aria-hidden />
                <span className="sr-only">{tc('guests', { count: guests })}</span>
                <span aria-hidden>{guests}</span>
              </span>
            )}
            {minutes !== null && (
              <span className="inline-flex items-center gap-1 rounded-full bg-black/5 px-2 py-0.5 tabular-nums dark:bg-white/10">
                <Clock className="size-3.5" aria-hidden />
                <span className="sr-only">{t('sinceSent', { minutes })}</span>
                <span aria-hidden>{tc('minutes', { minutes })}</span>
              </span>
            )}
          </span>
        )}
      </span>
    </button>
  );
}

/** Several groups at one table, each paying separately (RF-C05): open one or start another. */
function ChooseOrderDialog({
  choice,
  onClose,
  onOpen,
  onNew,
}: {
  choice: { table: FloorTable; orderIds: string[] } | null;
  onClose: () => void;
  onOpen: (orderId: string) => void;
  onNew: (table: FloorTable) => void;
}) {
  const t = useTranslations('posOrder.floor');
  const tc = useTranslations('posOrder.common');
  const lookups = useLookups();
  // Read when the dialog renders; it re-renders with the floor on every change.
  const orders = (choice?.orderIds ?? []).flatMap((id) => {
    const order = getPos().fold.orders.get(id);
    return order ? [order] : [];
  });
  return (
    <Dialog open={choice !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md" closeLabel={tc('close')}>
        {choice && (
          <>
            <DialogHeader>
              <DialogTitle>{t('table', { label: choice.table.label })}</DialogTitle>
              <DialogDescription>{t('chooseDescription')}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              {orders.map((order) => (
                <Button
                  key={order.id}
                  variant="outline"
                  size="lg"
                  className="h-auto justify-between gap-3 py-3 text-left"
                  onClick={() => onOpen(order.id)}
                >
                  <span className="flex flex-col">
                    <span className="font-semibold">
                      {tc('orderNumber', { number: order.displayNumber })}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {lookups.users.get(order.waiterUserId)?.displayName ?? tc('unknownUser')}
                      {order.guestCount ? ` · ${tc('guests', { count: order.guestCount })}` : ''}
                    </span>
                  </span>
                  <span className="tabular-nums">{formatPosMoney(order.totalRappen)}</span>
                </Button>
              ))}
              <Button size="lg" className="mt-2" onClick={() => onNew(choice.table)}>
                <Plus /> {t('newOrder')}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
