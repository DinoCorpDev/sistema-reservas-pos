'use client';

import {
  type ContentLanguage,
  type DiscountState,
  isContentLanguage,
  type OrderItemState,
  rappen,
  STANDARD_DISCOUNT_REASONS,
  VOID_REASONS,
} from '@pos/core';
import { formatPosMoney, posTaxName } from '@/pos/money';
import { Button } from '@pos/ui/button';
import { cn } from '@pos/ui/utils';
import { Minus, Plus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { removeDiscount, updateItem, voidItem } from '../../actions';
import { translatedName } from '../../catalog';
import { getPos, usePos } from '@/device/store';
import { requestApproval } from '../../ui-store';
import { clamp, formatPercentBp } from './format';
import type { OrderData } from './hooks';
import { useRunner } from './run';
import { ITEM_STATUS_STYLES } from './status';

/** Names of a line in the waiter's language (the line itself keeps the location's). */
export function useLineNames() {
  const language = usePos((state) => state.user?.uiLanguage);
  const lang: ContentLanguage | null = isContentLanguage(language) ? language : null;
  return (item: OrderItemState) => ({
    name: lang ? translatedName(item.productId, item.name, lang) : item.name,
    variant:
      item.variantName === null
        ? null
        : lang
          ? translatedName(item.variantId, item.variantName, lang)
          : item.variantName,
    modifiers: item.modifiers.map((modifier) => ({
      ...modifier,
      name: lang ? translatedName(modifier.modifierId, modifier.name, lang) : modifier.name,
    })),
  });
}

/** Label of a discount: its preset or reason, and the percentage when it is one. */
export function useDiscountLabel() {
  const t = useTranslations('posOrder.discountReason');
  const presets = usePos((state) => state.bootstrap)?.location.settings.pos.discountPresets ?? [];
  return (discount: Pick<DiscountState, 'reasonCode' | 'kind' | 'value'>) => {
    const preset = presets.find((p) => p.code === discount.reasonCode);
    const reason = (STANDARD_DISCOUNT_REASONS as readonly string[]).includes(discount.reasonCode)
      ? t(discount.reasonCode)
      : (preset?.label ?? discount.reasonCode);
    return discount.kind === 'percent' ? `${reason} ${formatPercentBp(discount.value)}` : reason;
  };
}

/**
 * The order as the guest will pay it, grouped by course (RF-C08, RF-C09): each line with its
 * status (RF-C16), options, note, seat and discount. Pending lines change quantity in place;
 * tapping a line opens its actions. Voided lines stay, struck through (RN-11).
 */
export function Ticket({
  data,
  editable,
  onLine,
  className,
}: {
  data: OrderData;
  editable: boolean;
  onLine: (itemId: string) => void;
  className?: string;
}) {
  const t = useTranslations('posOrder.ticket');
  const { order, items, discounts } = data;
  const courses = [...new Set(items.map((item) => item.course))].sort((a, b) => a - b);
  const orderDiscount = discounts.find((discount) => discount.itemId === null) ?? null;

  return (
    <section className={cn('flex min-h-0 flex-col bg-card', className)} aria-label={t('title')}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <p className="p-6 text-center text-muted-foreground">{t('empty')}</p>
        ) : (
          courses.map((course) => (
            <div key={course}>
              <h2 className="sticky top-0 z-10 border-b bg-muted px-3 py-1.5 text-sm font-semibold">
                {t('course', { course })}
              </h2>
              <ul>
                {items
                  .filter((item) => item.course === course)
                  .map((item) => (
                    <TicketLine
                      key={item.id}
                      orderId={order.id}
                      item={item}
                      discount={discounts.find((d) => d.itemId === item.id) ?? null}
                      editable={editable}
                      onOpen={() => onLine(item.id)}
                    />
                  ))}
              </ul>
            </div>
          ))
        )}
      </div>
      <Totals data={data} orderDiscount={orderDiscount} editable={editable} />
    </section>
  );
}

function TicketLine({
  orderId,
  item,
  discount,
  editable,
  onOpen,
}: {
  orderId: string;
  item: OrderItemState;
  discount: DiscountState | null;
  editable: boolean;
  onOpen: () => void;
}) {
  const t = useTranslations('posOrder.ticket');
  const ts = useTranslations('posOrder.itemStatus');
  const tc = useTranslations('posOrder.common');
  const names = useLineNames()(item);
  const label = useDiscountLabel();
  const run = useRunner();
  const voided = item.prepStatus === 'voided';
  const pending = item.prepStatus === 'pending';
  const own = discount && !voided ? discount.amountRappen : 0;

  async function change(delta: number) {
    if (item.quantity + delta >= 1) {
      await run(async () => {
        // Read inside the queue: earlier taps may have changed it already.
        const current = getPos().fold.items.get(item.id);
        if (!current || current.prepStatus !== 'pending') return;
        const quantity = clamp(current.quantity + delta, 1, 999);
        if (quantity !== current.quantity) await updateItem(orderId, item.id, { quantity });
      });
      return;
    }
    // Down to zero: the pending line is voided as an entry error (RN-11: nothing is deleted).
    const approval = await requestApproval({ kind: 'void_item', prepStatus: 'pending' });
    if (approval === null) return;
    await run(async () => {
      const current = getPos().fold.items.get(item.id);
      if (!current || current.prepStatus !== 'pending') return;
      await voidItem(
        orderId,
        item.id,
        { quantity: current.quantity, reason: 'entry_error' },
        approval === 'allowed' ? null : approval,
      );
    });
  }

  return (
    <li
      data-testid="line"
      data-item-id={item.id}
      data-status={item.prepStatus}
      className="flex items-stretch gap-1 border-b px-1.5 py-1"
    >
      {editable && pending ? (
        <div className="flex shrink-0 items-center">
          <Button
            variant="ghost"
            size="icon"
            aria-label={tc('minus')}
            onClick={() => void change(-1)}
          >
            <Minus />
          </Button>
          <span className="w-7 text-center text-lg font-semibold tabular-nums">
            {item.quantity}
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label={tc('plus')}
            onClick={() => void change(1)}
          >
            <Plus />
          </Button>
        </div>
      ) : (
        <span
          className={cn(
            'flex w-11 shrink-0 items-center justify-center text-lg font-semibold tabular-nums',
            voided && 'text-muted-foreground line-through',
          )}
        >
          {item.quantity}×
        </span>
      )}
      <button
        type="button"
        aria-label={t('lineActions')}
        disabled={!editable || voided}
        onClick={onOpen}
        className="flex min-h-11 min-w-0 flex-1 flex-col gap-0.5 rounded-md px-2 py-1 text-left outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:hover:bg-transparent"
      >
        <span className="flex w-full items-start justify-between gap-2">
          <span
            className={cn('min-w-0 font-medium', voided && 'text-muted-foreground line-through')}
          >
            {names.name}
            {names.variant && <span className="text-muted-foreground"> · {names.variant}</span>}
          </span>
          <span className="flex shrink-0 flex-col items-end tabular-nums">
            <span className={cn(voided && 'text-muted-foreground line-through')}>
              {formatPosMoney(rappen(item.grossRappen - own))}
            </span>
            {own > 0 && (
              <span className="text-xs text-muted-foreground line-through">
                {formatPosMoney(item.grossRappen)}
              </span>
            )}
          </span>
        </span>
        {names.modifiers.length > 0 && (
          <span className="text-sm text-muted-foreground">
            {names.modifiers
              .map((m) =>
                m.priceDeltaRappen === 0
                  ? m.name
                  : `${m.name} (+${formatPosMoney(m.priceDeltaRappen, { currency: false })})`,
              )
              .join(', ')}
          </span>
        )}
        {item.note && <span className="text-sm italic">{t('note', { note: item.note })}</span>}
        <span className="flex flex-wrap items-center gap-1.5 text-xs">
          <span
            className={cn('rounded px-1.5 py-0.5 font-medium', ITEM_STATUS_STYLES[item.prepStatus])}
          >
            {ts(item.prepStatus)}
          </span>
          {item.seat !== null && (
            <span className="rounded bg-muted px-1.5 py-0.5">
              {tc('seat', { seat: item.seat })}
            </span>
          )}
          {discount && !voided && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-900">
              {t('lineDiscount', { label: label(discount) })}
            </span>
          )}
          {voided && item.voidReason && <VoidReasonText reason={item.voidReason} />}
        </span>
      </button>
    </li>
  );
}

function VoidReasonText({ reason }: { reason: string }) {
  const tv = useTranslations('posOrder.voidReason');
  const known = (VOID_REASONS as readonly string[]).includes(reason);
  return <span className="text-destructive">{known ? tv(reason) : reason}</span>;
}

function Totals({
  data,
  orderDiscount,
  editable,
}: {
  data: OrderData;
  orderDiscount: DiscountState | null;
  editable: boolean;
}) {
  const t = useTranslations('posOrder.ticket');
  const label = useDiscountLabel();
  const run = useRunner();
  const { order } = data;
  const lineDiscounts = order.discountTotalRappen - (orderDiscount?.amountRappen ?? 0);
  const row = 'flex items-center justify-between gap-3';
  return (
    <div className="grid shrink-0 gap-1 border-t bg-card p-3 text-sm">
      <div className={row}>
        <span>{t('subtotal')}</span>
        <span className="tabular-nums">{formatPosMoney(order.subtotalRappen)}</span>
      </div>
      {lineDiscounts > 0 && (
        <div className={row}>
          <span>{t('lineDiscounts')}</span>
          <span className="tabular-nums">{formatPosMoney(rappen(-lineDiscounts))}</span>
        </div>
      )}
      {orderDiscount && (
        <div className={row}>
          <span className="flex min-w-0 items-center gap-1">
            <span className="truncate">{t('orderDiscount', { label: label(orderDiscount) })}</span>
            {editable && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('removeDiscount')}
                onClick={() => void run(() => removeDiscount(order.id, orderDiscount.id))}
              >
                <X />
              </Button>
            )}
          </span>
          <span className="tabular-nums">
            {formatPosMoney(rappen(-orderDiscount.amountRappen))}
          </span>
        </div>
      )}
      <div className={cn(row, 'text-lg font-bold')}>
        <span>{t('total')}</span>
        <span data-testid="order-total" className="tabular-nums">
          {formatPosMoney(order.totalRappen)}
        </span>
      </div>
      <div className={cn(row, 'text-xs text-muted-foreground')}>
        <span>{t('tax', { tax: posTaxName() ?? t('taxName') })}</span>
        <span className="tabular-nums">{formatPosMoney(order.taxTotalRappen)}</span>
      </div>
      {order.paidRappen !== 0 && (
        <div className={row}>
          <span>{t('paid')}</span>
          <span className="tabular-nums">{formatPosMoney(order.paidRappen)}</span>
        </div>
      )}
      <div className={cn(row, 'font-semibold')}>
        <span>{t('balance')}</span>
        <span data-testid="order-balance" className="tabular-nums">
          {formatPosMoney(order.balanceRappen)}
        </span>
      </div>
    </div>
  );
}
