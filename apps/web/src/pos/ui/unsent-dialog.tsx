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
import { Send } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { sendItems } from '../actions';
import { usePosUi } from '../ui-store';
import { useRunner } from './order/run';

/**
 * Leaving an order with dishes that were added but never sent (RF-C09): the kitchen would never
 * see them, so the waiter sends them now or leaves on purpose.
 */
export function UnsentDialog() {
  const t = useTranslations('posOrder.unsent');
  const leaving = usePosUi((state) => state.leaving);
  const leaveTo = usePosUi((state) => state.leaveTo);
  const run = useRunner();
  const [busy, setBusy] = useState(false);

  async function sendAndLeave() {
    if (!leaving) return;
    setBusy(true);
    const result = await run(() => sendItems(leaving.orderId));
    setBusy(false);
    if (result.ok) leaveTo(leaving.next);
  }

  return (
    <Dialog
      open={leaving !== null}
      onOpenChange={(open) => !open && usePosUi.setState({ leaving: null })}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description', { count: leaving?.count ?? 0 })}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-wrap gap-2">
          <Button variant="ghost" onClick={() => usePosUi.setState({ leaving: null })}>
            {t('stay')}
          </Button>
          <Button variant="outline" onClick={() => leaving && leaveTo(leaving.next)}>
            {t('leave')}
          </Button>
          <Button size="lg" disabled={busy} onClick={() => void sendAndLeave()}>
            <Send /> {t('send')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
