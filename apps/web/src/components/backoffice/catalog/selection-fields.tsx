'use client';

import { Field } from '@pos/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@pos/ui/select';
import { useTranslations } from 'next-intl';

const MIN_OPTIONS = Array.from({ length: 21 }, (_, i) => i);
const MAX_OPTIONS = Array.from({ length: 20 }, (_, i) => i + 1);

/** True when the selection range is valid: at least 1, at most 20, min ≤ max. */
export const selectionValid = (min: number, max: number) => min >= 0 && max >= 1 && min <= max;

/**
 * Minimum and maximum selection of a modifier group (RF-B02): min > 0 makes the group required.
 * Shows the "min ≤ max" problem before the form is sent.
 */
export function SelectionFields({
  min,
  max,
  onChange,
  disabled,
  errors = {},
}: {
  min: number;
  max: number;
  onChange: (value: { min: number; max: number }) => void;
  disabled?: boolean;
  errors?: { minSelect?: string; maxSelect?: string };
}) {
  const t = useTranslations('modifiers');
  const invalid = min > max;
  return (
    <div className="grid grid-cols-2 gap-4">
      <Field
        label={t('minSelect')}
        hint={min > 0 ? t('requiredHint', { count: min }) : t('optionalHint')}
        error={invalid ? t('minAboveMax') : errors.minSelect}
      >
        <Select
          value={String(min)}
          disabled={disabled}
          onValueChange={(value) => onChange({ min: Number(value), max })}
        >
          <SelectTrigger aria-label={t('minSelect')} aria-invalid={invalid}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MIN_OPTIONS.map((value) => (
              <SelectItem key={value} value={String(value)}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label={t('maxSelect')} hint={t('maxHint')} error={errors.maxSelect}>
        <Select
          value={String(max)}
          disabled={disabled}
          onValueChange={(value) => onChange({ min, max: Number(value) })}
        >
          <SelectTrigger aria-label={t('maxSelect')} aria-invalid={invalid}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MAX_OPTIONS.map((value) => (
              <SelectItem key={value} value={String(value)}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </div>
  );
}
