'use client';

import {
  CHF_DENOMINATIONS,
  countTotal,
  type DenominationCount,
  type DenominationKey,
  formatChf,
} from '@pos/core';
import { Button } from '@pos/ui/button';
import { Input } from '@pos/ui/input';
import { Minus, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';

/** CHF 5 Rp … CHF 1000: coins up to CHF 5, notes from CHF 10. */
const label = (value: number) => (value < 100 ? `${value} Rp.` : `${value / 100}.–`);

/**
 * Counting cash by denomination (RF-D12, RF-D14): one row per coin and note, with ± buttons
 * (≥ 44 px) and a field for the number of pieces; the total updates as it is typed.
 */
export function DenominationCounter({
  value,
  onChange,
  idPrefix,
}: {
  value: DenominationCount;
  onChange: (next: DenominationCount) => void;
  idPrefix: string;
}) {
  const t = useTranslations('posCash.count');
  const set = (key: DenominationKey, pieces: number) =>
    onChange({ ...value, [key]: Math.max(0, Math.min(99_999, Math.trunc(pieces) || 0)) });
  const groups = [
    { title: t('notes'), values: CHF_DENOMINATIONS.filter((d) => d >= 1000).reverse() },
    { title: t('coins'), values: CHF_DENOMINATIONS.filter((d) => d < 1000).reverse() },
  ];
  return (
    // Sized by its own width, not the screen's: inside a dialog the groups stack and every
    // field keeps room for its number.
    <div className="@container grid gap-4">
      <div className="grid gap-4 @3xl:grid-cols-2">
        {groups.map((group) => (
          <fieldset key={group.title} className="grid content-start gap-1.5">
            <legend className="mb-1 text-sm font-medium text-muted-foreground">
              {group.title}
            </legend>
            {group.values.map((denomination) => {
              const key = String(denomination) as DenominationKey;
              const pieces = value[key] ?? 0;
              const id = `${idPrefix}-${key}`;
              return (
                <div
                  key={key}
                  className="grid grid-cols-[4rem_2.75rem_minmax(4rem,1fr)_2.75rem] items-center gap-2 @md:grid-cols-[4.5rem_2.75rem_minmax(5rem,1fr)_2.75rem_6.5rem]"
                >
                  <label htmlFor={id} className="font-medium tabular-nums">
                    {label(denomination)}
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-11"
                    aria-label={t('less', { denomination: label(denomination) })}
                    onClick={() => set(key, pieces - 1)}
                  >
                    <Minus />
                  </Button>
                  <Input
                    id={id}
                    inputMode="numeric"
                    autoComplete="off"
                    className="h-11 min-w-0 px-2 text-center text-xl font-semibold tabular-nums"
                    value={pieces === 0 ? '' : String(pieces)}
                    placeholder="0"
                    data-testid={`count-${key}`}
                    onFocus={(event) => event.currentTarget.select()}
                    onChange={(event) =>
                      set(key, Number(event.currentTarget.value.replace(/\D/g, '')))
                    }
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-11"
                    aria-label={t('more', { denomination: label(denomination) })}
                    onClick={() => set(key, pieces + 1)}
                  >
                    <Plus />
                  </Button>
                  <span className="hidden text-right text-sm text-muted-foreground tabular-nums @md:block">
                    {pieces > 0
                      ? formatChf(countTotalOf(denomination, pieces), { currency: false })
                      : ''}
                  </span>
                </div>
              );
            })}
          </fieldset>
        ))}
      </div>
      <p className="flex items-baseline justify-between rounded-lg bg-muted px-3 py-2">
        <span className="font-medium">{t('total')}</span>
        <span className="text-2xl font-bold tabular-nums" data-testid="count-total">
          {formatChf(countTotal(value))}
        </span>
      </p>
    </div>
  );
}

const countTotalOf = (denomination: number, pieces: number) =>
  countTotal({ [String(denomination)]: pieces } as DenominationCount);
