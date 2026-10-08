'use client';

import type { KitchenTicketView } from '@pos/core';
import { Button } from '@pos/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@pos/ui/tabs';
import { toast } from '@pos/ui/toaster';
import { Lock } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useMemo, useRef, useState } from 'react';
import { lockTerminal } from '@/device/pin';
import { usePos } from '@/device/store';
import { StatusIndicator } from '@/device/ui/status-indicator';
import {
  advanceItem,
  readyTicket,
  recallTicket,
  reprintTicket,
  serveTicket,
  startTicket,
} from '../actions';
import { useNow, useStationBoard } from '../board';
import { type TicketActions, TicketCard } from './ticket-card';

/**
 * The kitchen display of one station (RF-C20…RF-C28): the open tickets oldest first, a notice
 * for every item voided after it reached the kitchen (RN-13) until the cook confirms it, and the
 * recall list of what was finished in the last hours. Works on the LAN through the hub (RF-C27).
 */
export function KdsShell() {
  const t = useTranslations('kds');
  const format = useFormatter();
  const now = useNow();
  const { station, board, labels } = useStationBoard(now);
  const user = usePos((state) => state.user);
  const tables = usePos((state) => state.bootstrap?.tables);
  const users = usePos((state) => state.bootstrap?.users);
  const printers = usePos((state) => state.printers);
  const [acknowledged, setAcknowledged] = useState<Set<string>>(() => new Set());
  // Voids older than this screen are struck on the tickets, without a new notice.
  const since = useRef(Date.now());

  const run = (task: () => Promise<void>) => {
    task().catch((error: unknown) => {
      console.error(error);
      toast.error(t('failed'));
    });
  };
  const actions: TicketActions = {
    start: (ticket) => run(() => startTicket(ticket)),
    ready: (ticket) => run(() => readyTicket(ticket)),
    serve: (ticket) => run(() => serveTicket(ticket)),
    recall: (ticket) => run(() => recallTicket(ticket)),
    reprint: (ticket) =>
      run(async () => {
        await reprintTicket(ticket);
        toast.success(t('reprinted'));
      }),
    advance: (ticket, itemId) => run(() => advanceItem(ticket, itemId)),
  };

  const stornos = useMemo(() => {
    if (!board) return [];
    const list: { key: string; ticket: KitchenTicketView; name: string; quantity: number }[] = [];
    for (const ticket of [...board.active, ...board.done]) {
      for (const item of ticket.items) {
        if (item.status !== 'voided' || !item.voidedAt) continue;
        if (Date.parse(item.voidedAt) < since.current) continue;
        const key = `${ticket.key}:${item.itemId}`;
        if (!acknowledged.has(key))
          list.push({ key, ticket, name: item.name, quantity: item.quantity });
      }
    }
    return list;
  }, [board, acknowledged]);

  if (!station || !board) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6 text-center">
        <p className="max-w-md text-lg">{t('noStation')}</p>
      </main>
    );
  }

  const tableOf = (ticket: KitchenTicketView) =>
    tables?.find((table) => table.id === ticket.tableId)?.label ?? null;
  const waiterOf = (ticket: KitchenTicketView) =>
    users?.find((u) => u.id === ticket.waiterUserId)?.displayName ?? null;
  const printerHealth = station.printer ? printers[station.printer.id] : undefined;

  const grid = (tickets: KitchenTicketView[], done: boolean) =>
    tickets.length === 0 ? (
      <p className="p-8 text-center text-lg text-muted-foreground">
        {done ? t('noneDone') : t('noneOpen')}
      </p>
    ) : (
      <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {tickets.map((ticket) => (
          <TicketCard
            key={ticket.key}
            ticket={ticket}
            labels={labels}
            tableLabel={tableOf(ticket)}
            waiterName={waiterOf(ticket)}
            canReprint={Boolean(station.printer)}
            actions={actions}
            done={done}
          />
        ))}
      </div>
    );

  return (
    <Tabs defaultValue="open" className="flex min-h-dvh flex-col gap-0">
      <header className="flex flex-wrap items-center gap-3 border-b bg-card px-3 py-2">
        <h1 className="text-xl font-bold" data-testid="kds-station">
          {station.name}
        </h1>
        <TabsList className="w-auto">
          <TabsTrigger value="open">{t('tabs.open', { count: board.active.length })}</TabsTrigger>
          <TabsTrigger value="done">{t('tabs.done')}</TabsTrigger>
        </TabsList>
        <span className="text-lg font-semibold tabular-nums">
          {format.dateTime(new Date(now), { hour: '2-digit', minute: '2-digit' })}
        </span>
        <div className="ml-auto flex items-center gap-3">
          <StatusIndicator />
          <span className="text-sm font-medium" data-testid="kds-user">
            {user?.displayName}
          </span>
          <Button variant="outline" size="icon" onClick={lockTerminal} aria-label={t('lock')}>
            <Lock />
          </Button>
        </div>
      </header>
      {printerHealth && !printerHealth.ok && (
        <div className="bg-destructive/10 px-4 py-2 text-sm text-destructive" role="alert">
          {t('printerDown', { printer: station.printer!.name, error: printerHealth.error ?? '' })}
        </div>
      )}
      {stornos.length > 0 && (
        <div
          className="flex flex-col gap-2 bg-destructive px-4 py-3 text-white"
          role="alert"
          data-testid="kds-storno"
        >
          {stornos.map((storno) => (
            <div key={storno.key} className="flex items-center justify-between gap-3">
              <span className="text-lg font-semibold">
                {labels.storno}: {storno.quantity}× {storno.name} —{' '}
                {storno.ticket.channel === 'table' && tableOf(storno.ticket)
                  ? `${labels.table} ${tableOf(storno.ticket)}`
                  : storno.ticket.displayNumber}
              </span>
              <Button
                variant="secondary"
                onClick={() => setAcknowledged((previous) => new Set(previous).add(storno.key))}
              >
                {t('acknowledge')}
              </Button>
            </div>
          ))}
        </div>
      )}
      <TabsContent value="open" className="flex-1">
        {grid(board.active, false)}
      </TabsContent>
      <TabsContent value="done" className="flex-1">
        {grid(board.done, true)}
      </TabsContent>
    </Tabs>
  );
}
