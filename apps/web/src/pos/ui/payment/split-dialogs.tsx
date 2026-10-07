'use client';

import {
  formatChf,
  itemsOf,
  type OrderItemState,
  type Rappen,
  rappen,
  splitEvenly,
} from '@pos/core';
import { Badge } from '@pos/ui/badge';
import { Button } from '@pos/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@pos/ui/dialog';
import { Input } from '@pos/ui/input';
import { Label } from '@pos/ui/label';
import { cn } from '@pos/ui/utils';
import { Check, Minus, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { splitOrder } from '../../actions';
import { usePosUi } from '../../ui-store';
import { useFold } from './hooks';
import { MAX_SPLIT_PARTS, MIN_SPLIT_PARTS } from './model';

// ── Equal parts: payments labelled "1/N", "2/N"… on the same order (DEC-025) ─

export function EqualSplitDialog({
  open,
  onOpenChange,
  balance,
  initialParts,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  balance: Rappen;
  initialParts: number;
  onApply: (parts: number) => void;
}) {
  const t = useTranslations('posPayment.split');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" closeLabel={t('close')}>
        <DialogHeader>
          <DialogTitle>{t('equalTitle')}</DialogTitle>
          <DialogDescription>{t('equalDescription')}</DialogDescription>
        </DialogHeader>
        <EqualSplitBody
          balance={balance}
          initialParts={initialParts}
          onCancel={() => onOpenChange(false)}
          onApply={(parts) => {
            onApply(parts);
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function EqualSplitBody({
  balance,
  initialParts,
  onCancel,
  onApply,
}: {
  balance: Rappen;
  initialParts: number;
  onCancel: () => void;
  onApply: (parts: number) => void;
}) {
  const t = useTranslations('posPayment.split');
  const [text, setText] = useState(String(initialParts));
  const parts = Number(text);
  const valid = Number.isInteger(parts) && parts >= MIN_SPLIT_PARTS && parts <= MAX_SPLIT_PARTS;
  const step = (delta: number) =>
    setText(
      String(Math.min(MAX_SPLIT_PARTS, Math.max(MIN_SPLIT_PARTS, (valid ? parts : 2) + delta))),
    );

  // Equal amounts grouped: "2 × CHF 33.33, 1 × CHF 33.34".
  const groups = new Map<number, number>();
  if (valid && balance > 0) {
    for (const amount of splitEvenly(balance, parts)) {
      groups.set(amount, (groups.get(amount) ?? 0) + 1);
    }
  }

  return (
    <>
      <div className="grid gap-3">
        <Label htmlFor="split-parts">{t('partsCount')}</Label>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-12"
            aria-label={t('fewer')}
            disabled={valid && parts <= MIN_SPLIT_PARTS}
            onClick={() => step(-1)}
          >
            <Minus />
          </Button>
          <Input
            id="split-parts"
            type="number"
            inputMode="numeric"
            min={MIN_SPLIT_PARTS}
            max={MAX_SPLIT_PARTS}
            value={text}
            aria-invalid={!valid || undefined}
            className="h-12 w-24 text-center text-xl font-semibold tabular-nums"
            onChange={(event) => setText(event.currentTarget.value)}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-12"
            aria-label={t('more')}
            disabled={valid && parts >= MAX_SPLIT_PARTS}
            onClick={() => step(1)}
          >
            <Plus />
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {[2, 3, 4, 5, 6].map((count) => (
            <Button
              key={count}
              type="button"
              variant={count === parts ? 'default' : 'outline'}
              className="min-w-12"
              aria-pressed={count === parts}
              onClick={() => setText(String(count))}
            >
              {count}
            </Button>
          ))}
        </div>
        {valid ? (
          <ul className="grid gap-1 rounded-lg bg-muted px-3 py-2 text-sm">
            {[...groups.entries()]
              .sort(([a], [b]) => b - a)
              .map(([amount, count]) => (
                <li key={amount} className="tabular-nums">
                  {t('previewGroup', { count, amount: formatChf(rappen(amount)) })}
                </li>
              ))}
          </ul>
        ) : (
          <p className="text-sm text-destructive">
            {t('partsRange', { min: MIN_SPLIT_PARTS, max: MAX_SPLIT_PARTS })}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('abort')}
        </Button>
        <Button type="button" disabled={!valid} onClick={() => onApply(parts)}>
          {t('apply')}
        </Button>
      </DialogFooter>
    </>
  );
}

// ── By items or by seat: a child order paid on its own (RF-C12, DEC-025) ────

export type SplitMode = 'items' | 'seat';

const seatKey = (item: OrderItemState) => (item.seat === null ? 'none' : String(item.seat));

/** Lines grouped by seat, in seat order; lines without a seat last. */
export function seatGroups(items: readonly OrderItemState[]) {
  const groups = new Map<string, OrderItemState[]>();
  for (const item of items) {
    const key = seatKey(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.entries()]
    .map(([key, groupItems]) => ({
      key,
      seat: groupItems[0]?.seat ?? null,
      items: groupItems,
      totalRappen: rappen(groupItems.reduce((sum, item) => sum + item.lineTotalRappen, 0)),
    }))
    .sort((a, b) => (a.seat ?? Number.MAX_SAFE_INTEGER) - (b.seat ?? Number.MAX_SAFE_INTEGER));
}

export function SplitItemsDialog({
  orderId,
  mode,
  onOpenChange,
}: {
  orderId: string;
  mode: SplitMode | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('posPayment.split');
  return (
    <Dialog open={mode !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" closeLabel={t('close')}>
        <DialogHeader>
          <DialogTitle>{mode === 'seat' ? t('seatTitle') : t('itemsTitle')}</DialogTitle>
          <DialogDescription>
            {mode === 'seat' ? t('seatDescription') : t('itemsDescription')}
          </DialogDescription>
        </DialogHeader>
        {mode && (
          <SplitItemsBody orderId={orderId} mode={mode} onCancel={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function SplitItemsBody({
  orderId,
  mode,
  onCancel,
}: {
  orderId: string;
  mode: SplitMode;
  onCancel: () => void;
}) {
  const t = useTranslations('posPayment.split');
  const navigate = usePosUi((state) => state.navigate);
  const fold = useFold();
  const items = itemsOf(fold, orderId).filter((item) => item.prepStatus !== 'voided');
  const groups = seatGroups(items);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [seat, setSeat] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen =
    mode === 'seat'
      ? (groups.find((group) => group.key === seat)?.items ?? [])
      : items.filter((item) => selected.has(item.id));
  const chosenTotal = rappen(chosen.reduce((sum, item) => sum + item.lineTotalRappen, 0));
  const keepsSome = chosen.length < items.length;
  const valid = chosen.length > 0 && keepsSome;

  function toggle(itemId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  async function confirm() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const childId = await splitOrder(
        orderId,
        chosen.map((item) => item.id),
      );
      // The part split off is paid on its own (RF-C12).
      navigate({ name: 'payment', orderId: childId });
    } catch {
      setError(t('failed'));
      setBusy(false);
    }
  }

  const itemLabel = (item: OrderItemState) =>
    `${item.quantity} × ${item.variantName ? `${item.name} (${item.variantName})` : item.name}`;

  return (
    <>
      <div className="grid max-h-[50dvh] gap-2 overflow-y-auto pr-1">
        {mode === 'items'
          ? items.map((item) => {
              const on = selected.has(item.id);
              return (
                <Button
                  key={item.id}
                  type="button"
                  variant={on ? 'secondary' : 'outline'}
                  aria-pressed={on}
                  className={cn(
                    'h-auto min-h-12 w-full min-w-0 justify-between text-left',
                    on && 'ring-2 ring-primary',
                  )}
                  onClick={() => toggle(item.id)}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Check className={cn(!on && 'invisible')} aria-hidden />
                    <span className="truncate">{itemLabel(item)}</span>
                    {item.seat !== null && (
                      <Badge variant="outline">{t('seat', { seat: item.seat })}</Badge>
                    )}
                  </span>
                  <span className="tabular-nums">{formatChf(item.lineTotalRappen)}</span>
                </Button>
              );
            })
          : groups.map((group) => {
              const on = seat === group.key;
              return (
                <Button
                  key={group.key}
                  type="button"
                  variant={on ? 'secondary' : 'outline'}
                  aria-pressed={on}
                  className={cn(
                    'h-auto min-h-14 w-full min-w-0 justify-between text-left',
                    on && 'ring-2 ring-primary',
                  )}
                  onClick={() => setSeat(group.key)}
                >
                  <span className="flex min-w-0 flex-col items-start">
                    <span className="font-semibold">
                      {group.seat === null ? t('noSeat') : t('seat', { seat: group.seat })}
                    </span>
                    <span className="truncate text-sm font-normal text-muted-foreground">
                      {group.items.map(itemLabel).join(', ')}
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {t('seatSummary', {
                      count: group.items.length,
                      amount: formatChf(group.totalRappen),
                    })}
                  </span>
                </Button>
              );
            })}
      </div>
      <p className="text-sm tabular-nums" aria-live="polite">
        {chosen.length > 0 && !keepsSome
          ? t('keepOne')
          : t('selection', { count: chosen.length, amount: formatChf(chosenTotal) })}
      </p>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('abort')}
        </Button>
        <Button type="button" disabled={!valid || busy} onClick={() => void confirm()}>
          {t('confirm')}
        </Button>
      </DialogFooter>
    </>
  );
}
