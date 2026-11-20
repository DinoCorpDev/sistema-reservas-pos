'use client';

import {
  bestDisplayUnit,
  type DisplayUnit,
  displayUnitsOf,
  fromBaseQuantity,
  type StockUnit,
  toBaseQuantity,
} from '@pos/core';
import { Input } from '@pos/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@pos/ui/select';
import { useLocale, useTranslations } from 'next-intl';

/** Formats whole base units (g, ml, pieces) as the restaurant reads them: «19,5 kg», «12 uds.». */
export function useQuantity() {
  const locale = useLocale();
  const t = useTranslations('inventory.unitShort');
  return (quantity: number, unit: StockUnit, displayUnit?: DisplayUnit) => {
    const shown = fromBaseQuantity(quantity, unit, displayUnit);
    const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(shown.value);
    return `${number} ${t(shown.unit)}`;
  };
}

/** What the person is typing: the text as written and the unit chosen next to it. */
export interface QuantityDraft {
  text: string;
  displayUnit: DisplayUnit;
}

export function quantityDraft(quantity: number | null, unit: StockUnit): QuantityDraft {
  if (quantity === null) return { text: '', displayUnit: displayUnitsOf(unit)[0]! };
  const displayUnit = bestDisplayUnit(quantity, unit);
  return { text: String(fromBaseQuantity(quantity, unit, displayUnit).value), displayUnit };
}

/** The base units of a draft, null if empty, undefined if it is not a number. */
export function draftQuantity(draft: QuantityDraft, unit: StockUnit): number | null | undefined {
  if (draft.text.trim() === '') return null;
  return toBaseQuantity(draft.text, draft.displayUnit, unit) ?? undefined;
}

/** A number field with its unit (kg or g, l or ml, pieces). */
export function QuantityInput({
  id,
  unit,
  value,
  onChange,
  placeholder,
  allowNegative = false,
}: {
  id: string;
  unit: StockUnit;
  value: QuantityDraft;
  onChange: (value: QuantityDraft) => void;
  placeholder?: string;
  allowNegative?: boolean;
}) {
  const t = useTranslations('inventory.unitShort');
  const units = displayUnitsOf(unit);
  return (
    <div className="flex gap-2">
      <Input
        id={id}
        inputMode="decimal"
        className="min-w-0 flex-1 tabular-nums"
        value={value.text}
        placeholder={placeholder}
        onChange={(event) => {
          const text = event.target.value.replace(allowNegative ? /[^\d.,-]/g : /[^\d.,]/g, '');
          onChange({ ...value, text });
        }}
      />
      {units.length > 1 ? (
        <Select
          value={value.displayUnit}
          onValueChange={(displayUnit) =>
            onChange({ ...value, displayUnit: displayUnit as DisplayUnit })
          }
        >
          <SelectTrigger className="w-24" aria-label={t(value.displayUnit)}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {units.map((u) => (
              <SelectItem key={u} value={u}>
                {t(u)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <span className="flex w-24 items-center px-3 text-sm text-muted-foreground">
          {t(units[0]!)}
        </span>
      )}
    </div>
  );
}
