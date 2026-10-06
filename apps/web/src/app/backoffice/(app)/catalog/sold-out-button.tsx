'use client';

import { Button } from '@pos/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@pos/ui/dropdown-menu';
import { BanIcon, CalendarClockIcon, InfinityIcon, RotateCcwIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useServerAction } from '@/components/backoffice/use-server-action';
import { markSoldOut, restoreSoldOut } from './actions';

/**
 * "86" at the current location (RF-B09, RN-17): the product stops being orderable on every channel
 * at once, until tomorrow (start of the next business day, 04:00) or until it is restored.
 */
export function SoldOutButton({
  productId,
  productName,
  soldOut,
  disabled,
}: {
  productId: string;
  productName: string;
  soldOut: boolean;
  disabled?: boolean;
}) {
  const t = useTranslations('soldOut');
  const mark = useServerAction(
    (nextBusinessDay: boolean) =>
      markSoldOut(productId, nextBusinessDay ? { nextBusinessDay: true } : {}),
    { successMessage: t('markedToast', { name: productName }) },
  );
  const restore = useServerAction(() => restoreSoldOut(productId), {
    successMessage: t('restoredToast', { name: productName }),
  });
  const pending = mark.pending || restore.pending;

  if (soldOut) {
    return (
      <Button
        variant="outline"
        disabled={disabled || pending}
        onClick={() => void restore.run()}
        aria-label={t('restoreLabel', { name: productName })}
      >
        <RotateCcwIcon /> {t('restore')}
      </Button>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled || pending}
          aria-label={t('markLabel', { name: productName })}
        >
          <BanIcon /> {t('mark')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t('until')}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => void mark.run(true)}>
          <CalendarClockIcon /> {t('untilTomorrow')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void mark.run(false)}>
          <InfinityIcon /> {t('untilRestored')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
