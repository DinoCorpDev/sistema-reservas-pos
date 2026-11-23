'use client';

import {
  allergenName,
  allergySummary,
  courseLabel,
  type KitchenLabels,
  type KitchenTicketView,
} from '@pos/core';
import { Badge } from '@pos/ui/badge';
import { Button } from '@pos/ui/button';
import { cn } from '@pos/ui/utils';
import {
  Armchair,
  Beer,
  Check,
  ChefHat,
  Clock3,
  HandPlatter,
  Printer,
  RotateCcw,
  ShieldAlert,
  ShoppingBag,
} from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

/** Where the ticket is for, as an icon beside the table or number (DEC-053). */
const CHANNEL_ICONS = { table: Armchair, bar: Beer, takeaway: ShoppingBag } as const;

/** The dot of each item status: the same colours as the item backgrounds below. */
const ITEM_DOTS: Record<string, string> = {
  sent: 'bg-sky-500',
  preparing: 'bg-amber-500',
  ready: 'bg-emerald-500',
  served: 'bg-slate-400',
  voided: 'bg-destructive',
};

const ITEM_STYLES: Record<string, string> = {
  sent: 'bg-card',
  preparing: 'bg-amber-50 dark:bg-amber-950/40',
  ready: 'bg-emerald-50 dark:bg-emerald-950/40',
  served: 'bg-muted text-muted-foreground',
  voided: 'bg-destructive/5 text-destructive line-through decoration-2',
};

export interface TicketActions {
  start: (ticket: KitchenTicketView) => void;
  ready: (ticket: KitchenTicketView) => void;
  serve: (ticket: KitchenTicketView) => void;
  recall: (ticket: KitchenTicketView) => void;
  reprint: (ticket: KitchenTicketView) => void;
  advance: (ticket: KitchenTicketView, itemId: string) => void;
}

/**
 * One ticket of the station (RF-C20): table or number, waiter, time and timer with the delay
 * alert (RF-C24), items by course with modifiers, notes, seat and allergens in the kitchen
 * language (RF-C25), voided items struck through (RN-13), and the station an item belongs to when
 * it came here because nobody was there (DEC-033). Tapping an item moves it one step; the buttons
 * move the whole ticket (RF-C22).
 */
export function TicketCard({
  ticket,
  labels,
  tableLabel,
  waiterName,
  stationName,
  canReprint,
  actions,
  done = false,
}: {
  ticket: KitchenTicketView;
  labels: KitchenLabels;
  tableLabel: string | null;
  waiterName: string | null;
  stationName: (id: string) => string;
  canReprint: boolean;
  actions: TicketActions;
  done?: boolean;
}) {
  const t = useTranslations('kds.ticket');
  const format = useFormatter();
  const where =
    ticket.channel === 'table' && tableLabel
      ? `${labels.table} ${tableLabel}`
      : `${labels.channels[ticket.channel]} ${ticket.displayNumber}`;
  const live = ticket.items.filter((i) => i.status !== 'voided' && i.status !== 'served');
  const hasSent = live.some((i) => i.status === 'sent');
  const allReady = live.length > 0 && live.every((i) => i.status === 'ready');
  const readyShare =
    live.length === 0 ? 0 : live.filter((i) => i.status === 'ready').length / live.length;
  const ChannelIcon = CHANNEL_ICONS[ticket.channel as keyof typeof CHANNEL_ICONS] ?? ChefHat;

  return (
    <article
      className={cn(
        'flex flex-col overflow-hidden rounded-2xl border-2 bg-card shadow-card',
        ticket.alert
          ? 'border-destructive'
          : ticket.status === 'preparing'
            ? 'border-amber-500'
            : 'border-border',
        done && 'opacity-90',
      )}
      data-testid="kds-ticket"
      data-key={ticket.key}
      data-status={ticket.status}
      data-alert={ticket.alert}
      aria-label={where}
    >
      <header
        className={cn(
          'flex items-start justify-between gap-2 px-3 py-2.5',
          ticket.alert ? 'bg-destructive text-white' : 'bg-surface-2',
        )}
      >
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            aria-hidden
            className={cn(
              'mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg',
              ticket.alert ? 'bg-white/20' : 'bg-brand-soft text-brand-strong',
            )}
          >
            <ChannelIcon className="size-5" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate font-brand text-xl font-semibold">{where}</h2>
            <p className={cn('text-sm', ticket.alert ? 'text-white/90' : 'text-muted-foreground')}>
              {[
                ticket.channel === 'table' ? `#${ticket.displayNumber}` : null,
                format.dateTime(new Date(ticket.sentAt), { hour: '2-digit', minute: '2-digit' }),
                waiterName,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          {/* The minutes since it was sent; red with the delay alert (RF-C24). */}
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xl font-bold tabular-nums',
              ticket.alert
                ? 'bg-white/20'
                : ticket.status === 'preparing'
                  ? 'bg-amber-100 text-amber-900 dark:bg-amber-400/15 dark:text-amber-100'
                  : 'border bg-card',
            )}
            data-testid="kds-elapsed"
          >
            <Clock3 className="size-4" aria-hidden />
            {t('minutes', { minutes: ticket.elapsedMinutes })}
          </span>
          {ticket.hasStorno && <Badge variant="destructive">{labels.storno}</Badge>}
          {ticket.reprintCount > 0 && <Badge variant="outline">{labels.reprint}</Badge>}
        </div>
      </header>

      {/* How much of the ticket is ready. */}
      {live.length > 0 ? (
        <div className="h-1.5 bg-muted" aria-hidden>
          <div
            className="h-full bg-emerald-500 transition-[width] duration-300"
            style={{ width: `${Math.round(readyShare * 100)}%` }}
          />
        </div>
      ) : null}

      {/* A guest is allergic: whatever this ticket lists, keep it away from them (DEC-037). */}
      {ticket.allergies && (
        <div
          role="alert"
          data-testid="kds-allergy"
          className="flex items-start gap-2 bg-destructive px-3 py-2 text-white"
        >
          <ShieldAlert className="mt-0.5 size-6 shrink-0" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-bold tracking-wide">{labels.allergyAlert}</p>
            <p className="text-lg leading-tight font-bold">
              {allergySummary(labels, ticket.allergies)}
            </p>
            <p className="text-sm text-white/90">{labels.allergyCare}</p>
          </div>
        </div>
      )}

      <div className="flex flex-1 flex-col gap-1 p-2">
        {ticket.courses.map((course) => (
          <section key={course} className="flex flex-col gap-1">
            {ticket.courses.length > 1 || course !== 1 ? (
              <h3 className="px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {courseLabel(labels, course)}
              </h3>
            ) : null}
            {ticket.items
              .filter((item) => item.course === course)
              .map((item) => {
                const movable = item.status !== 'voided' && item.status !== 'served';
                const contains = item.allergens.filter((a) => a.presence === 'contains');
                const traces = item.allergens.filter((a) => a.presence !== 'contains');
                return (
                  <button
                    key={item.itemId}
                    type="button"
                    disabled={!movable}
                    onClick={() => actions.advance(ticket, item.itemId)}
                    className={cn(
                      'flex min-h-12 flex-col items-start gap-0.5 rounded-xl border px-3 py-2 text-left transition-colors duration-150 disabled:cursor-default',
                      ITEM_STYLES[item.status],
                    )}
                    data-testid="kds-item"
                    data-status={item.status}
                    aria-label={t('itemLabel', {
                      name: item.name,
                      status: t(`status.${item.status}`),
                    })}
                  >
                    <span className="flex w-full items-baseline justify-between gap-2">
                      <span className="text-lg font-semibold">
                        {item.quantity}× {item.name}
                        {item.variantName ? ` (${item.variantName})` : ''}
                      </span>
                      <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium no-underline">
                        <span
                          aria-hidden
                          className={cn('size-2 rounded-full', ITEM_DOTS[item.status])}
                        />
                        {item.status === 'voided' ? labels.storno : t(`status.${item.status}`)}
                      </span>
                    </span>
                    {item.fromStationId && (
                      <Badge
                        variant="outline"
                        className="border-sky-600 text-sky-800 dark:text-sky-200"
                        data-testid="kds-from-station"
                      >
                        {labels.fromStation} {stationName(item.fromStationId)}
                      </Badge>
                    )}
                    {item.modifiers.map((m, index) => (
                      <span key={index} className="text-sm">
                        + {m.quantity > 1 ? `${m.quantity}× ` : ''}
                        {m.name}
                      </span>
                    ))}
                    {item.note && (
                      <span className="rounded bg-amber-200 px-1.5 text-sm font-semibold text-amber-950">
                        {labels.note}: {item.note}
                      </span>
                    )}
                    {item.seat !== null && (
                      <span className="text-sm text-muted-foreground">
                        {labels.seat} {item.seat}
                      </span>
                    )}
                    {(contains.length > 0 || traces.length > 0) && (
                      <span
                        className="text-sm font-medium text-destructive"
                        data-testid="kds-allergens"
                      >
                        ⚠ {contains.map((a) => allergenName(labels, a.allergen)).join(', ')}
                        {traces.length > 0 &&
                          ` (${labels.traces}: ${traces.map((a) => allergenName(labels, a.allergen)).join(', ')})`}
                      </span>
                    )}
                    {item.movedToOrderId && (
                      <span className="text-xs text-muted-foreground">{t('moved')}</span>
                    )}
                  </button>
                );
              })}
          </section>
        ))}
      </div>

      <footer className="flex flex-wrap gap-2 border-t bg-surface-2 p-2.5 [&_[data-slot=button]]:min-h-12">
        {!done && hasSent && (
          <Button variant="outline" className="flex-1 gap-2" onClick={() => actions.start(ticket)}>
            <ChefHat /> {t('start')}
          </Button>
        )}
        {!done && live.length > 0 && !allReady && (
          <Button className="flex-1 gap-2" onClick={() => actions.ready(ticket)}>
            <Check /> {t('ready')}
          </Button>
        )}
        {live.length > 0 && (allReady || done) && (
          <Button variant="outline" className="flex-1 gap-2" onClick={() => actions.serve(ticket)}>
            <HandPlatter /> {t('served')}
          </Button>
        )}
        {done && ticket.status === 'ready' && (
          <Button variant="outline" className="flex-1 gap-2" onClick={() => actions.recall(ticket)}>
            <RotateCcw /> {t('recall')}
          </Button>
        )}
        {canReprint && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => actions.reprint(ticket)}
            aria-label={t('reprint')}
          >
            <Printer />
          </Button>
        )}
      </footer>
    </article>
  );
}
