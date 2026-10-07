import type { ItemPrepStatus, OrderPaymentStatus, TableState } from '@pos/core';

/** Colours of the derived table states on the map (RF-C01); the legend uses the same ones. */
export const TABLE_STATE_STYLES: Record<TableState, string> = {
  free: 'border-border bg-background text-foreground',
  reserved: 'border-dashed border-indigo-400 bg-indigo-50 text-indigo-950',
  awaiting_order: 'border-amber-400 bg-amber-100 text-amber-950',
  in_kitchen: 'border-sky-400 bg-sky-100 text-sky-950',
  ready: 'border-emerald-700 bg-emerald-500 text-white',
  awaiting_payment: 'border-violet-400 bg-violet-100 text-violet-950',
  occupied: 'border-slate-400 bg-slate-200 text-slate-900',
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
  pending: 'bg-amber-100 text-amber-900',
  sent: 'bg-sky-100 text-sky-900',
  preparing: 'bg-sky-100 text-sky-900',
  ready: 'bg-emerald-100 text-emerald-900',
  served: 'bg-slate-100 text-slate-700',
  voided: 'bg-destructive/15 text-destructive',
};

/** Badge colours of the payment status of an order (RF-C16). */
export const PAYMENT_STATUS_STYLES: Record<OrderPaymentStatus, string> = {
  unpaid: 'bg-muted text-muted-foreground',
  partial: 'bg-amber-100 text-amber-900',
  paid: 'bg-emerald-100 text-emerald-900',
  refunded: 'bg-destructive/15 text-destructive',
};
