'use client';

import { VOID_REASONS, type VoidReason } from '@pos/core';
import { Button } from '@pos/ui/button';
import { Input } from '@pos/ui/input';
import { Field } from '@pos/ui/label';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { NumberStepper } from './stepper';

export interface VoidInput {
  reason: VoidReason;
  reasonText: string | null;
  quantity: number;
}

/**
 * Voiding a line or an order (RF-C10, RN-11): the reason is mandatory ("other" needs a text),
 * part of a line's quantity can be voided, and nothing is ever deleted.
 */
export function VoidForm({
  maxQuantity,
  busy,
  onConfirm,
}: {
  /** Quantity of the line; null when voiding the whole order. */
  maxQuantity: number | null;
  busy: boolean;
  onConfirm: (input: VoidInput) => void;
}) {
  const t = useTranslations('posOrder.void');
  const tv = useTranslations('posOrder.voidReason');
  const [reason, setReason] = useState<VoidReason | null>(null);
  const [quantity, setQuantity] = useState<number | null>(maxQuantity);
  const [note, setNote] = useState('');
  const reasonId = useId();
  const noteId = useId();
  const noteMissing = reason === 'other' && note.trim() === '';
  const ready = reason !== null && !noteMissing && (maxQuantity === null || quantity !== null);

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready || busy || reason === null) return;
        onConfirm({
          reason,
          reasonText: note.trim() === '' ? null : note.trim(),
          quantity: quantity ?? 1,
        });
      }}
    >
      <div className="grid gap-2">
        <span id={reasonId} className="text-sm font-medium">
          {t('reason')}
        </span>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-labelledby={reasonId}>
          {VOID_REASONS.map((code) => (
            <Button
              key={code}
              type="button"
              role="radio"
              aria-checked={reason === code}
              variant={reason === code ? 'default' : 'outline'}
              className="h-auto min-h-12 whitespace-normal"
              onClick={() => setReason(code)}
            >
              {tv(code)}
            </Button>
          ))}
        </div>
      </div>
      {maxQuantity !== null && maxQuantity > 1 && (
        <NumberStepper
          label={t('quantity')}
          value={quantity}
          onChange={setQuantity}
          min={1}
          max={maxQuantity}
        />
      )}
      <Field label={t('note')} htmlFor={noteId} error={noteMissing ? t('noteRequired') : undefined}>
        <Input
          id={noteId}
          value={note}
          maxLength={500}
          onChange={(event) => setNote(event.target.value)}
        />
      </Field>
      <Button type="submit" variant="destructive" size="lg" disabled={!ready || busy}>
        {t('confirm')}
      </Button>
    </form>
  );
}
