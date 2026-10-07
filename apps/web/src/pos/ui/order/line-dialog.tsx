'use client';

import { type DiscountState, MAX_COURSE, type OrderItemState } from '@pos/core';
import { Button } from '@pos/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@pos/ui/dialog';
import { Input } from '@pos/ui/input';
import { Field } from '@pos/ui/label';
import { ArrowLeft, Ban, HandPlatter, Percent, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { removeDiscount, serveItems, updateItem, voidItem } from '../../actions';
import { requestApproval } from '../../ui-store';
import { DiscountForm } from './discount-form';
import type { OrderData } from './hooks';
import { useRunner } from './run';
import { NumberStepper } from './stepper';
import { useLineNames } from './ticket';
import { VoidForm, type VoidInput } from './void-form';

type Mode = 'menu' | 'discount' | 'void';

/**
 * Actions on one line: change note, seat, course or quantity while it is pending (RF-C08),
 * discount it (RF-C11), void it with a reason and maybe only part of it (RF-C10), or mark it
 * served.
 */
export function LineDialog({
  data,
  itemId,
  onClose,
}: {
  data: OrderData;
  itemId: string | null;
  onClose: () => void;
}) {
  const tc = useTranslations('posOrder.common');
  // A line that was voided or moved meanwhile has no actions left: the dialog closes.
  const item =
    itemId === null
      ? null
      : (data.items.find((entry) => entry.id === itemId && entry.prepStatus !== 'voided') ?? null);
  const discount = item ? (data.discounts.find((d) => d.itemId === item.id) ?? null) : null;
  return (
    <Dialog open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg" closeLabel={tc('close')}>
        {item && (
          <LineActions
            key={item.id}
            orderId={data.order.id}
            item={item}
            discount={discount}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function LineActions({
  orderId,
  item,
  discount,
  onClose,
}: {
  orderId: string;
  item: OrderItemState;
  discount: DiscountState | null;
  onClose: () => void;
}) {
  const t = useTranslations('posOrder.line');
  const tc = useTranslations('posOrder.common');
  const ts = useTranslations('posOrder.itemStatus');
  const names = useLineNames()(item);
  const run = useRunner();
  const [mode, setMode] = useState<Mode>('menu');
  const [busy, setBusy] = useState(false);
  const inKitchen =
    item.prepStatus === 'sent' || item.prepStatus === 'preparing' || item.prepStatus === 'ready';

  async function act(task: () => Promise<void>) {
    setBusy(true);
    const result = await run(task);
    setBusy(false);
    if (result.ok) onClose();
  }

  async function voidLine(input: VoidInput) {
    setBusy(true);
    const approval = await requestApproval({ kind: 'void_item', prepStatus: item.prepStatus });
    const result =
      approval === null
        ? null
        : await run(() =>
            voidItem(
              orderId,
              item.id,
              { quantity: input.quantity, reason: input.reason, reasonText: input.reasonText },
              approval === 'allowed' ? null : approval,
            ),
          );
    setBusy(false);
    if (result?.ok) onClose();
  }

  const description = [
    ts(item.prepStatus),
    tc('course', { course: item.course }),
    item.seat !== null ? tc('seat', { seat: item.seat }) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="grid gap-5">
      <DialogHeader>
        <DialogTitle>
          {item.quantity}× {names.name}
          {names.variant && ` · ${names.variant}`}
        </DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>

      {mode !== 'menu' && (
        <Button variant="ghost" className="justify-self-start" onClick={() => setMode('menu')}>
          <ArrowLeft /> {tc('back')}
        </Button>
      )}

      {mode === 'menu' && (
        <>
          {item.prepStatus === 'pending' && (
            <PendingEdit orderId={orderId} item={item} busy={busy} onSave={act} />
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <Button variant="outline" size="lg" disabled={busy} onClick={() => setMode('discount')}>
              <Percent /> {t('discount')}
            </Button>
            {discount && (
              <Button
                variant="outline"
                size="lg"
                disabled={busy}
                onClick={() => void act(() => removeDiscount(orderId, discount.id))}
              >
                <X /> {t('removeDiscount')}
              </Button>
            )}
            {inKitchen && (
              <Button
                variant="outline"
                size="lg"
                disabled={busy}
                onClick={() => void act(() => serveItems(orderId, [item.id]))}
              >
                <HandPlatter /> {t('serve')}
              </Button>
            )}
            <Button variant="destructive" size="lg" disabled={busy} onClick={() => setMode('void')}>
              <Ban /> {t('void')}
            </Button>
          </div>
        </>
      )}

      {mode === 'discount' && (
        <DiscountForm orderId={orderId} itemId={item.id} base={item.grossRappen} onDone={onClose} />
      )}

      {mode === 'void' && (
        <>
          {item.prepStatus !== 'pending' && <p className="text-sm">{t('voidSentHint')}</p>}
          <VoidForm
            maxQuantity={item.quantity}
            busy={busy}
            onConfirm={(input) => void voidLine(input)}
          />
        </>
      )}
    </div>
  );
}

/** Note, seat, course and quantity of a line not sent yet (RF-C08). */
function PendingEdit({
  orderId,
  item,
  busy,
  onSave,
}: {
  orderId: string;
  item: OrderItemState;
  busy: boolean;
  onSave: (task: () => Promise<void>) => Promise<void>;
}) {
  const t = useTranslations('posOrder.product');
  const tc = useTranslations('posOrder.common');
  const [quantity, setQuantity] = useState<number | null>(item.quantity);
  const [note, setNote] = useState(item.note ?? '');
  const [seat, setSeat] = useState<number | null>(item.seat);
  const [course, setCourse] = useState<number | null>(item.course);
  const noteId = useId();

  function save() {
    if (quantity === null || course === null) return;
    const trimmed = note.trim() === '' ? null : note.trim();
    const fields: Parameters<typeof updateItem>[2] = {};
    if (quantity !== item.quantity) fields.quantity = quantity;
    if (trimmed !== item.note) fields.note = trimmed;
    if (seat !== item.seat) fields.seat = seat;
    if (course !== item.course) fields.course = course;
    void onSave(async () => {
      if (Object.keys(fields).length > 0) await updateItem(orderId, item.id, fields);
    });
  }

  return (
    <form
      className="grid gap-4 rounded-xl border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <NumberStepper
          label={t('quantity')}
          value={quantity}
          onChange={setQuantity}
          min={1}
          max={999}
        />
        <NumberStepper
          label={t('seat')}
          value={seat}
          onChange={setSeat}
          min={1}
          max={99}
          allowEmpty
        />
        <NumberStepper
          label={t('course')}
          value={course}
          onChange={setCourse}
          min={1}
          max={MAX_COURSE}
        />
        <Field label={t('note')} htmlFor={noteId}>
          <Input
            id={noteId}
            value={note}
            maxLength={500}
            placeholder={t('notePlaceholder')}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
      </div>
      <Button type="submit" size="lg" disabled={busy || quantity === null || course === null}>
        {tc('save')}
      </Button>
    </form>
  );
}
