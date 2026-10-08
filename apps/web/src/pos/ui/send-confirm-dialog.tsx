'use client';

import { Button } from '@pos/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@pos/ui/dialog';
import { Send, UserX } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePosUi } from '../ui-store';
import { useStationName } from './order/send';

/**
 * Nobody is logged in at a station the items go to (DEC-033): opened by `confirmRedirects()`.
 * The waiter sends them to the replacement station (usually the kitchen) or cancels.
 */
export function SendConfirmDialog() {
  const t = useTranslations('posOrder.routing');
  const request = usePosUi((state) => state.sendConfirm);
  const stationName = useStationName();

  const close = (confirmed: boolean) => {
    request?.resolve(confirmed);
    usePosUi.setState({ sendConfirm: null });
  };

  const redirected = request?.redirected ?? [];
  const names = (ids: string[]) => [...new Set(ids)].map(stationName).join(', ');
  const stations = names(redirected.map((r) => r.fromStationId));
  const targets = names(redirected.map((r) => r.toStationId));
  const count = new Set(redirected.flatMap((r) => r.itemIds)).size;

  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && close(false)}>
      <DialogContent className="sm:max-w-md" data-testid="send-confirm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserX className="size-5 text-amber-600" aria-hidden />{' '}
            {t('confirmTitle', { stations })}
          </DialogTitle>
          <DialogDescription>
            {t('confirmDescription', { stations, targets, count })}
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-1 rounded-md bg-amber-50 p-3 text-amber-950">
          {redirected.map((r) => (
            <li key={`${r.fromStationId}>${r.toStationId}`}>
              {t('line', {
                count: r.itemIds.length,
                from: stationName(r.fromStationId),
                to: stationName(r.toStationId),
              })}
            </li>
          ))}
        </ul>
        <DialogFooter className="flex-wrap gap-2">
          <Button size="lg" variant="outline" onClick={() => close(false)}>
            {t('cancel')}
          </Button>
          <Button size="lg" onClick={() => close(true)}>
            <Send /> {t('confirm', { targets })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
