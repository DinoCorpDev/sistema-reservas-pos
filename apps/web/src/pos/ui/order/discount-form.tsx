'use client';

import {
  type DiscountKind,
  formatChf,
  MoneyError,
  parseChf,
  type Rappen,
  rappen,
  STANDARD_DISCOUNT_REASONS,
} from '@pos/core';
import { Button } from '@pos/ui/button';
import { Input } from '@pos/ui/input';
import { Field } from '@pos/ui/label';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { applyDiscount } from '../../actions';
import { usePos } from '../../store';
import { requestApproval } from '../../ui-store';
import { effectivePercentBp, formatPercentBp, parsePercentBp } from './format';
import { useRunner } from './run';

type Reason = (typeof STANDARD_DISCOUNT_REASONS)[number];

function parseAmount(input: string): number | null {
  try {
    const amount = parseChf(input);
    return amount > 0 ? amount : null;
  } catch (error) {
    if (error instanceof MoneyError) return null;
    throw error;
  }
}

/**
 * Discount on a line or on the whole order (RF-C11): the location's frequent discounts as
 * buttons, or a percentage or amount with its reason. Above the location threshold a manager
 * approves it with their PIN (RN-15); the threshold is checked on the effective percentage.
 */
export function DiscountForm({
  orderId,
  itemId,
  base,
  onDone,
}: {
  orderId: string;
  /** null = discount on the order. */
  itemId: string | null;
  /** What the discount applies to, for the effective percentage. */
  base: Rappen;
  onDone: () => void;
}) {
  const t = useTranslations('posOrder.discount');
  const tr = useTranslations('posOrder.discountReason');
  const presets = usePos((state) => state.bootstrap)?.location.settings.pos.discountPresets ?? [];
  const run = useRunner();
  const [kind, setKind] = useState<DiscountKind>('percent');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState<Reason | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const valueId = useId();
  const noteId = useId();

  const parsed = kind === 'percent' ? parsePercentBp(value) : parseAmount(value);
  const noteMissing = reason === 'other' && note.trim() === '';
  const canApply = base > 0 && parsed !== null && reason !== null && !noteMissing && !busy;

  const presetLabel = (code: string, label: string | null) =>
    (STANDARD_DISCOUNT_REASONS as readonly string[]).includes(code) ? tr(code) : (label ?? code);

  async function apply(input: {
    kind: DiscountKind;
    value: number;
    reasonCode: string;
    reasonText: string | null;
  }) {
    if (busy || base <= 0) return;
    setBusy(true);
    const approval = await requestApproval({
      kind: 'discount',
      percentBp: effectivePercentBp(input.kind, input.value, base),
    });
    const result =
      approval === null
        ? null
        : await run(() =>
            applyDiscount(orderId, { itemId, ...input }, approval === 'allowed' ? null : approval),
          );
    setBusy(false);
    if (result?.ok) onDone();
  }

  return (
    <div className="grid gap-5">
      <p className="text-sm text-muted-foreground">{t('base', { amount: formatChf(base) })}</p>
      {base <= 0 && <p className="text-destructive">{t('nothingToDiscount')}</p>}

      {presets.length > 0 && (
        <section className="grid gap-2" aria-label={t('presets')}>
          <h3 className="font-medium">{t('presets')}</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {presets.map((preset) => (
              <Button
                key={preset.code}
                type="button"
                variant="secondary"
                size="lg"
                disabled={busy || base <= 0}
                className="h-auto min-h-14 flex-col gap-0 py-2"
                onClick={() =>
                  void apply({
                    kind: preset.kind,
                    value: preset.value,
                    reasonCode: preset.code,
                    reasonText: null,
                  })
                }
              >
                <span>{presetLabel(preset.code, preset.label)}</span>
                <span className="text-sm opacity-80">
                  {preset.kind === 'percent'
                    ? formatPercentBp(preset.value)
                    : formatChf(rappen(preset.value))}
                </span>
              </Button>
            ))}
          </div>
        </section>
      )}

      <form
        className="grid gap-4"
        aria-label={t('custom')}
        onSubmit={(event) => {
          event.preventDefault();
          if (!canApply || parsed === null || reason === null) return;
          void apply({
            kind,
            value: parsed,
            reasonCode: reason,
            reasonText: note.trim() === '' ? null : note.trim(),
          });
        }}
      >
        <h3 className="font-medium">{t('custom')}</h3>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t('kind')}>
          {(['percent', 'amount'] as const).map((option) => (
            <Button
              key={option}
              type="button"
              role="radio"
              aria-checked={kind === option}
              variant={kind === option ? 'default' : 'outline'}
              onClick={() => {
                setKind(option);
                setValue('');
              }}
            >
              {t(option)}
            </Button>
          ))}
        </div>
        <Field
          label={kind === 'percent' ? t('valuePercent') : t('valueAmount')}
          htmlFor={valueId}
          error={
            value.trim() !== '' && parsed === null
              ? kind === 'percent'
                ? t('invalidPercent')
                : t('invalidAmount')
              : undefined
          }
        >
          <Input
            id={valueId}
            inputMode="decimal"
            autoComplete="off"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="text-lg tabular-nums"
          />
        </Field>
        <div className="grid gap-2">
          <span className="text-sm font-medium" id={`${valueId}-reason`}>
            {t('reason')}
          </span>
          <div
            className="grid grid-cols-2 gap-2"
            role="radiogroup"
            aria-labelledby={`${valueId}-reason`}
          >
            {STANDARD_DISCOUNT_REASONS.map((code) => (
              <Button
                key={code}
                type="button"
                role="radio"
                aria-checked={reason === code}
                variant={reason === code ? 'default' : 'outline'}
                onClick={() => setReason(code)}
              >
                {tr(code)}
              </Button>
            ))}
          </div>
        </div>
        <Field
          label={t('note')}
          htmlFor={noteId}
          error={noteMissing ? t('noteRequired') : undefined}
        >
          <Input
            id={noteId}
            value={note}
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
        <Button type="submit" size="lg" disabled={!canApply}>
          {t('apply')}
        </Button>
        <p className="text-sm text-muted-foreground">{t('approvalHint')}</p>
      </form>
    </div>
  );
}
