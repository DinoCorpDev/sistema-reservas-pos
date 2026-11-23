'use client';

import { Button } from '@pos/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@pos/ui/dropdown-menu';
import { Badge } from '@pos/ui/badge';
import { CalendarClockIcon, ChevronDownIcon, InfinityIcon, RotateCcwIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useServerAction } from '@/components/backoffice/use-server-action';
import { markSoldOut, restoreSoldOut } from './actions';

/**
 * Availability at the current location, shown as a state people read at a glance (DEC-053):
 * "Available" opens the sold-out menu; "Sold out" offers to restore it. This is the kitchen's "86"
 * at the current location (RF-B09, RN-17): the product stops being orderable on every channel
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
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="destructive" dot>
          {t('stateSoldOut')}
        </Badge>
        <Button
          variant="ghost"
          className="px-2.5 text-sm"
          disabled={disabled || pending}
          onClick={() => void restore.run()}
          aria-label={t('restoreLabel', { name: productName })}
        >
          <RotateCcwIcon className="size-4!" /> {t('restore')}
        </Button>
      </div>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="gap-2 rounded-full pr-2.5 pl-3 text-sm"
          disabled={disabled || pending}
          aria-label={t('markLabel', { name: productName })}
        >
          <span aria-hidden className="size-2 rounded-full bg-success ring-4 ring-success/15" />
          {t('stateAvailable')}
          <ChevronDownIcon className="size-4! text-muted-foreground" />
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
