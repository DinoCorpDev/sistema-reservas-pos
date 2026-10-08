'use client';

import { allergenName, courseLabel, type KitchenLabels, type KitchenTicketView } from '@pos/core';
import { Badge } from '@pos/ui/badge';
import { Button } from '@pos/ui/button';
import { cn } from '@pos/ui/utils';
import { Check, ChefHat, HandPlatter, Printer, RotateCcw } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

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
 * language (RF-C25), voided items struck through (RN-13). Tapping an item moves it one step;
 * the buttons move the whole ticket (RF-C22).
 */
export function TicketCard({
  ticket,
  labels,
  tableLabel,
  waiterName,
  canReprint,
  actions,
  done = false,
}: {
  ticket: KitchenTicketView;
  labels: KitchenLabels;
  tableLabel: string | null;
  waiterName: string | null;
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

  return (
    <article
      className={cn(
        'flex flex-col overflow-hidden rounded-xl border-2 bg-card shadow-sm',
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
          'flex items-start justify-between gap-2 px-3 py-2',
          ticket.alert ? 'bg-destructive text-white' : 'bg-muted',
        )}
      >
        <div className="min-w-0">
          <h2 className="truncate text-xl font-bold">{where}</h2>
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
        <div className="flex flex-col items-end gap-1">
          <span className="text-2xl font-bold tabular-nums" data-testid="kds-elapsed">
            {t('minutes', { minutes: ticket.elapsedMinutes })}
          </span>
          {ticket.hasStorno && <Badge variant="destructive">{labels.storno}</Badge>}
          {ticket.reprintCount > 0 && <Badge variant="outline">{labels.reprint}</Badge>}
        </div>
      </header>

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
                      'flex min-h-11 flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left disabled:cursor-default',
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
                      <span className="shrink-0 text-xs font-medium no-underline">
                        {item.status === 'voided' ? labels.storno : t(`status.${item.status}`)}
                      </span>
                    </span>
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

      <footer className="flex flex-wrap gap-2 border-t p-2">
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
