'use client';

import { Button } from '@pos/ui/button';
import { Delete } from 'lucide-react';
import { useTranslations } from 'next-intl';

/** Touch keypad for PINs and amounts (RNF-22: keys ≥ 44 px, here 64 px). */
export function NumPad({
  onDigit,
  onBackspace,
  onClear,
  extraKey,
}: {
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  onClear?: () => void;
  /** Bottom-left key, e.g. "00" or "." for amounts; empty for PINs. */
  extraKey?: string;
}) {
  const t = useTranslations('pos.keypad');
  // Keys like cards (DEC-053): a soft shadow, a press that sinks, figures that line up.
  const key =
    'min-h-16 rounded-xl text-2xl font-semibold tabular-nums shadow-card active:translate-y-px active:shadow-none';
  return (
    <div className="grid grid-cols-3 gap-2" role="group" aria-label={t('label')}>
      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
        <Button
          key={digit}
          type="button"
          variant="outline"
          className={key}
          onClick={() => onDigit(digit)}
        >
          {digit}
        </Button>
      ))}
      {extraKey ? (
        <Button type="button" variant="outline" className={key} onClick={() => onDigit(extraKey)}>
          {extraKey}
        </Button>
      ) : onClear ? (
        <Button type="button" variant="ghost" className={key} onClick={onClear}>
          {t('clear')}
        </Button>
      ) : (
        <span />
      )}
      <Button type="button" variant="outline" className={key} onClick={() => onDigit('0')}>
        0
      </Button>
      <Button
        type="button"
        variant="ghost"
        className={key}
        onClick={onBackspace}
        aria-label={t('backspace')}
      >
        <Delete />
      </Button>
    </div>
  );
}
