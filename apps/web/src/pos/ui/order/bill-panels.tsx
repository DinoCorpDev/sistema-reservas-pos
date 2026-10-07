'use client';

import { Button } from '@pos/ui/button';
import { CreditCard, ExternalLink } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { mergeOrders, splitOrder, transferItems } from '../../actions';
import { usePosUi } from '../../ui-store';
import { type OrderData, useFoldMemo, useLookups, useOpenOrders } from './hooks';
import { ItemPicker, OrderPicker } from './pickers';
import { useRunner } from './run';

/**
 * Moving bills (RF-C12, RF-C13). Only an order without payments can give items away, merge or
 * split: what was paid stays where it was paid (DEC-025, RN-14). The menu disables these
 * actions in that case; the engine records a conflict if two offline terminals still do it.
 */

const validItems = (data: OrderData) => data.items.filter((item) => item.prepStatus !== 'voided');

/** Selected lines to another open order (RF-C13). */
export function TransferPanel({ data, onDone }: { data: OrderData; onDone: () => void }) {
  const t = useTranslations('posOrder.more');
  const run = useRunner();
  const lookups = useLookups();
  const others = useOpenOrders(data.order.id);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function transfer() {
    if (target === null || selected.size === 0) return;
    setBusy(true);
    const result = await run(() => transferItems(data.order.id, [...selected], target));
    setBusy(false);
    if (result.ok) onDone();
  }

  if (others.length === 0) return <p className="text-muted-foreground">{t('noOtherOrders')}</p>;
  return (
    <div className="grid gap-5">
      <ItemPicker
        items={validItems(data)}
        selected={selected}
        onChange={setSelected}
        label={t('transferItems')}
      />
      <OrderPicker
        orders={others}
        selectedId={target}
        onSelect={setTarget}
        lookups={lookups}
        label={t('transferTarget')}
      />
      <Button
        size="lg"
        disabled={busy || target === null || selected.size === 0}
        onClick={() => void transfer()}
      >
        {t('transferConfirm')}
      </Button>
    </div>
  );
}

/** This whole order into another one; this one ends as merged (RF-C13). */
export function MergePanel({ data, onDone }: { data: OrderData; onDone: () => void }) {
  const t = useTranslations('posOrder.more');
  const navigate = usePosUi((state) => state.navigate);
  const run = useRunner();
  const lookups = useLookups();
  const others = useOpenOrders(data.order.id);
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function merge() {
    if (target === null) return;
    setBusy(true);
    const result = await run(() => mergeOrders(data.order.id, target));
    setBusy(false);
    if (!result.ok) return;
    onDone();
    navigate({ name: 'order', orderId: target });
  }

  if (others.length === 0) return <p className="text-muted-foreground">{t('noOtherOrders')}</p>;
  return (
    <div className="grid gap-5">
      <p className="text-sm text-muted-foreground">{t('mergeDescription')}</p>
      <OrderPicker
        orders={others}
        selectedId={target}
        onSelect={setTarget}
        lookups={lookups}
        label={t('mergeTarget')}
      />
      <Button size="lg" disabled={busy || target === null} onClick={() => void merge()}>
        {t('mergeConfirm')}
      </Button>
    </div>
  );
}

/**
 * Splits by lines or by seat into a child order that is paid on its own (RF-C12, DEC-025).
 * Equal parts are not a split: they are labelled payments on the payment screen.
 */
export function SplitPanel({ data, onDone }: { data: OrderData; onDone: () => void }) {
  const t = useTranslations('posOrder.more');
  const tc = useTranslations('posOrder.common');
  const navigate = usePosUi((state) => state.navigate);
  const run = useRunner();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const createdNumber = useFoldMemo(
    (fold) => (created ? (fold.orders.get(created)?.displayNumber ?? null) : null),
    [created],
  );
  const items = validItems(data);
  const seats = [...new Set(items.flatMap((item) => (item.seat === null ? [] : [item.seat])))].sort(
    (a, b) => a - b,
  );
  const keepsOne = selected.size < items.length;

  async function split() {
    if (selected.size === 0 || !keepsOne) return;
    setBusy(true);
    const result = await run(() => splitOrder(data.order.id, [...selected]));
    setBusy(false);
    if (result.ok) setCreated(result.value);
  }

  if (created) {
    return (
      <div className="grid gap-4">
        <p className="text-lg" role="status">
          {t('splitDone', { number: createdNumber ?? '' })}
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          <Button
            size="lg"
            onClick={() => {
              onDone();
              navigate({ name: 'payment', orderId: created });
            }}
          >
            <CreditCard /> {t('payNew')}
          </Button>
          <Button
            size="lg"
            variant="outline"
            onClick={() => {
              onDone();
              navigate({ name: 'order', orderId: created });
            }}
          >
            <ExternalLink /> {t('openNew')}
          </Button>
          <Button size="lg" variant="outline" onClick={onDone}>
            {t('stayHere')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      <p className="text-sm text-muted-foreground">{t('splitDescription')}</p>
      {seats.length > 0 && (
        <div className="grid gap-2">
          <span className="text-sm font-medium">{t('splitBySeat')}</span>
          <div className="flex flex-wrap gap-2">
            {seats.map((seat) => (
              <Button
                key={seat}
                variant="secondary"
                onClick={() =>
                  setSelected(
                    new Set(items.filter((item) => item.seat === seat).map((item) => item.id)),
                  )
                }
              >
                {tc('seat', { seat })}
              </Button>
            ))}
          </div>
        </div>
      )}
      <ItemPicker
        items={items}
        selected={selected}
        onChange={setSelected}
        label={t('splitItems')}
      />
      {!keepsOne && <p className="text-sm text-destructive">{t('splitKeepOne')}</p>}
      <Button
        size="lg"
        disabled={busy || selected.size === 0 || !keepsOne}
        onClick={() => void split()}
      >
        {t('splitConfirm')}
      </Button>
    </div>
  );
}
