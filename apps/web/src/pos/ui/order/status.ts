import type { ItemPrepStatus, OrderPaymentStatus, TableState } from '@pos/core';
import {
  Armchair,
  BellRing,
  CalendarClock,
  ChefHat,
  ClipboardList,
  type LucideIcon,
  ReceiptText,
  Users,
} from 'lucide-react';

/** Colours of the derived table states on the map (RF-C01); the legend uses the same ones. */
export const TABLE_STATE_STYLES: Record<TableState, string> = {
  free: 'border-border bg-card text-foreground',
  reserved:
    'border-dashed border-indigo-400 bg-indigo-50 text-indigo-950 dark:bg-indigo-400/15 dark:text-indigo-100',
  awaiting_order:
    'border-amber-400 bg-amber-100 text-amber-950 dark:bg-amber-400/15 dark:text-amber-100',
  in_kitchen: 'border-sky-400 bg-sky-100 text-sky-950 dark:bg-sky-400/15 dark:text-sky-100',
  ready: 'border-emerald-700 bg-emerald-500 text-white',
  awaiting_payment:
    'border-violet-400 bg-violet-100 text-violet-950 dark:bg-violet-400/15 dark:text-violet-100',
  occupied: 'border-slate-400 bg-slate-200 text-slate-900 dark:bg-slate-400/20 dark:text-slate-100',
};

/** One icon per table state (DEC-053): the state reads before the words do. */
export const TABLE_STATE_ICONS: Record<TableState, LucideIcon> = {
  free: Armchair,
  reserved: CalendarClock,
  awaiting_order: ClipboardList,
  in_kitchen: ChefHat,
  ready: BellRing,
  awaiting_payment: ReceiptText,
  occupied: Users,
};

/** Order in which the legend lists the states: what needs attention first. */
export const LEGEND_STATES: readonly TableState[] = [
  'free',
  'awaiting_order',
  'in_kitchen',
  'ready',
  'awaiting_payment',
  'occupied',
  'reserved',
];

/** Badge colours of the preparation status of a line (RF-C16). */
export const ITEM_STATUS_STYLES: Record<ItemPrepStatus, string> = {
  pending: 'bg-amber-100 text-amber-900 dark:bg-amber-400/15 dark:text-amber-100',
  sent: 'bg-sky-100 text-sky-900 dark:bg-sky-400/15 dark:text-sky-100',
  preparing: 'bg-sky-100 text-sky-900 dark:bg-sky-400/15 dark:text-sky-100',
  ready: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-400/15 dark:text-emerald-100',
  served: 'bg-slate-100 text-slate-700 dark:bg-slate-400/15 dark:text-slate-200',
  voided: 'bg-destructive/15 text-destructive',
};

/** Badge colours of the payment status of an order (RF-C16). */
export const PAYMENT_STATUS_STYLES: Record<OrderPaymentStatus, string> = {
  unpaid: 'bg-muted text-muted-foreground',
  partial: 'bg-amber-100 text-amber-900 dark:bg-amber-400/15 dark:text-amber-100',
  paid: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-400/15 dark:text-emerald-100',
  refunded: 'bg-destructive/15 text-destructive',
};
