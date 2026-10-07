'use client';

import { Button } from '@pos/ui/button';
import { Input } from '@pos/ui/input';
import { Field } from '@pos/ui/label';
import { Minus, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';

/**
 * Whole number with −/+ buttons for the thumb (RNF-22) and a field that can also be typed in.
 * With `allowEmpty`, going below `min` (or clearing the field) means "none" (e.g. no seat).
 */
export function NumberStepper({
  label,
  value,
  onChange,
  min,
  max,
  allowEmpty = false,
  emptyText = '–',
  className,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  min: number;
  max: number;
  allowEmpty?: boolean;
  emptyText?: string;
  className?: string;
}) {
  const t = useTranslations('posOrder.common');
  const id = useId();
  // What is being typed, until the field loses focus; null = show the value.
  const [draft, setDraft] = useState<string | null>(null);

  const step = (delta: number) => {
    setDraft(null);
    if (value === null) {
      if (delta > 0) onChange(min);
      return;
    }
    const next = value + delta;
    if (next < min) {
      if (allowEmpty) onChange(null);
      return;
    }
    onChange(Math.min(max, next));
  };

  const type = (raw: string) => {
    setDraft(raw);
    const text = raw.trim();
    if (text === '') {
      if (allowEmpty) onChange(null);
      return;
    }
    if (!/^\d{1,4}$/.test(text)) return;
    const parsed = Number(text);
    if (parsed >= min && parsed <= max) onChange(parsed);
  };

  const canDecrease = value !== null && (allowEmpty || value > min);
  const canIncrease = value === null || value < max;
  return (
    <Field label={label} htmlFor={id} className={className}>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={t('minus')}
          aria-controls={id}
          disabled={!canDecrease}
          onClick={() => step(-1)}
        >
          <Minus />
        </Button>
        <Input
          id={id}
          inputMode="numeric"
          autoComplete="off"
          className="w-20 text-center text-lg font-semibold tabular-nums"
          placeholder={emptyText}
          value={draft ?? (value === null ? '' : String(value))}
          onChange={(event) => type(event.target.value)}
          onBlur={() => setDraft(null)}
          onFocus={(event) => event.target.select()}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={t('plus')}
          aria-controls={id}
          disabled={!canIncrease}
          onClick={() => step(1)}
        >
          <Plus />
        </Button>
      </div>
    </Field>
  );
}
