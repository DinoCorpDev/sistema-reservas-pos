'use client';

import { type FoldState, formatChf, itemsOf, type OrderState } from '@pos/core';
import { Badge } from '@pos/ui/badge';
import { Button } from '@pos/ui/button';
import { cn } from '@pos/ui/utils';
import { Armchair, Check, Divide, ListChecks } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { hasPayments } from '../../actions';
import type { EqualSplit } from './model';
import { EqualSplitDialog, seatGroups, type SplitMode, SplitItemsDialog } from './split-dialogs';

/**
 * Splitting the bill (RF-C12, DEC-025): in equal parts (payments labelled "1/N"… on this order),
 * or by items or by seat into a child order paid on its own. Moving items is only possible while
 * the order has no payments, because a payment never moves (RN-14).
 */
export function SplitControls({
  order,
  fold,
  split,
  onEqualSplit,
  onCancelSplit,
}: {
  order: OrderState;
  fold: FoldState;
  split: EqualSplit | null;
  onEqualSplit: (parts: number) => void;
  onCancelSplit: () => void;
}) {
  const t = useTranslations('posPayment.split');
  const tm = useTranslations('posPayment.methods');
  const [equalOpen, setEqualOpen] = useState(false);
  const [itemsMode, setItemsMode] = useState<SplitMode | null>(null);

  const paid = hasPayments(order.id);
  const items = itemsOf(fold, order.id).filter((item) => item.prepStatus !== 'voided');
  const canSplitItems = !paid && items.length >= 2;
  const canSplitSeats = canSplitItems && seatGroups(items).length >= 2;
  const splitButton =
    'h-auto min-h-14 flex-col gap-1 px-2 py-2 text-sm leading-tight whitespace-normal';

  return (
    <section aria-labelledby="payment-split-title" className="grid gap-2">
      <h3 id="payment-split-title" className="text-sm font-medium text-muted-foreground">
        {t('title')}
      </h3>
      <div className="grid grid-cols-3 gap-2">
        <Button
          type="button"
          variant="outline"
          className={splitButton}
          onClick={() => setEqualOpen(true)}
        >
          <Divide /> {t('equal')}
        </Button>
        <Button
          type="button"
          variant="outline"
          className={splitButton}
          disabled={!canSplitItems}
          onClick={() => setItemsMode('items')}
        >
          <ListChecks /> {t('byItems')}
        </Button>
        <Button
          type="button"
          variant="outline"
          className={splitButton}
          disabled={!canSplitSeats}
          onClick={() => setItemsMode('seat')}
        >
          <Armchair /> {t('bySeat')}
        </Button>
      </div>
      {paid ? (
        <p className="text-xs text-muted-foreground">{t('onlyEqualAfterPayment')}</p>
      ) : items.length < 2 ? (
        <p className="text-xs text-muted-foreground">{t('needsTwoItems')}</p>
      ) : null}

      {split && (
        <div className="grid gap-2 rounded-lg border bg-muted/40 p-3" data-testid="payment-split">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{t('active', { parts: split.parts })}</span>
            <Button type="button" variant="ghost" onClick={onCancelSplit}>
              {t('cancel')}
            </Button>
          </div>
          <ol className="grid max-h-44 gap-1 overflow-y-auto text-sm">
            {split.paid.map(({ index, payment }) => (
              <li
                key={payment.id}
                className="flex items-center justify-between gap-2 text-muted-foreground"
              >
                <span>
                  {t('part', { index, parts: split.parts })} · {tm(payment.method)}
                </span>
                <span className="flex items-center gap-1 tabular-nums">
                  <Check className="size-4 text-success" aria-hidden />
                  {formatChf(payment.amountRappen)}
                </span>
              </li>
            ))}
            {split.upcoming.map(({ index, amountRappen }, position) => (
              <li
                key={index}
                className={cn(
                  'flex items-center justify-between gap-2',
                  position === 0 && 'font-semibold',
                )}
              >
                <span className="flex items-center gap-2">
                  {t('part', { index, parts: split.parts })}
                  {position === 0 && <Badge>{t('partNow')}</Badge>}
                </span>
                <span className="tabular-nums">{formatChf(amountRappen)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <EqualSplitDialog
        open={equalOpen}
        onOpenChange={setEqualOpen}
        balance={order.balanceRappen}
        initialParts={split?.parts ?? 2}
        onApply={onEqualSplit}
      />
      <SplitItemsDialog
        orderId={order.id}
        mode={itemsMode}
        onOpenChange={(open) => !open && setItemsMode(null)}
      />
    </section>
  );
}
