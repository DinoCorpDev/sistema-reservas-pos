'use client';

import { ALLERGEN_PRESENCES, ALLERGENS } from '@pos/core';
import { cn } from '@pos/ui/utils';
import { useTranslations } from 'next-intl';
import type { AllergenMap } from './catalog-data';

const OPTIONS = ['none', ...ALLERGEN_PRESENCES] as const;

const selectedClass: Record<(typeof OPTIONS)[number], string> = {
  none: 'bg-background text-foreground shadow-sm',
  contains: 'bg-destructive/15 text-destructive shadow-sm',
  may_contain: 'bg-warning/25 text-foreground shadow-sm',
};

/** The 14 allergens (RF-B05), each "none", "contains" or "may contain traces". */
export function AllergenGrid({
  value,
  onChange,
  disabled,
  idPrefix,
}: {
  value: AllergenMap;
  onChange: (value: AllergenMap) => void;
  disabled?: boolean;
  idPrefix: string;
}) {
  const t = useTranslations('allergens');
  const tp = useTranslations('allergenPresence');
  return (
    <div className="grid gap-x-8 lg:grid-cols-2">
      {ALLERGENS.map((allergen) => {
        const current = value[allergen] ?? 'none';
        const labelId = `${idPrefix}-${allergen}`;
        return (
          <div
            key={allergen}
            className="flex flex-wrap items-center justify-between gap-2 border-b py-2.5 last:border-b-0 lg:[&:nth-last-child(2)]:border-b-0"
          >
            <span id={labelId} className="text-sm font-medium">
              {t(allergen)}
            </span>
            <div
              role="radiogroup"
              aria-labelledby={labelId}
              className="inline-flex rounded-lg bg-muted p-1"
            >
              {OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={current === option}
                  disabled={disabled}
                  onClick={() =>
                    onChange({ ...value, [allergen]: option === 'none' ? undefined : option })
                  }
                  className={cn(
                    'min-h-11 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors',
                    'focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50',
                    current === option && selectedClass[option],
                  )}
                >
                  {tp(option)}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
