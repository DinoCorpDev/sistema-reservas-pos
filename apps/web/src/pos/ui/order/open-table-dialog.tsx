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
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { openOrder } from '../../actions';
import { usePos } from '../../store';
import { usePosUi } from '../../ui-store';
import { useRunner } from './run';
import { NumberStepper } from './stepper';

const DEFAULT_GUESTS = 2;

/**
 * Opens a table (RF-C02): number of guests and the waiter, who is the person on the terminal.
 * Also used for a second, separately paid order at an occupied table (RF-C05).
 */
export function OpenTableDialog({
  table,
  onClose,
}: {
  table: { id: string; label: string } | null;
  onClose: () => void;
}) {
  const tc = useTranslations('posOrder.common');
  return (
    <Dialog open={table !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md" closeLabel={tc('close')}>
        {table && <OpenTableForm key={table.id} table={table} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function OpenTableForm({
  table,
  onClose,
}: {
  table: { id: string; label: string };
  onClose: () => void;
}) {
  const t = useTranslations('posOrder.openTable');
  const tc = useTranslations('posOrder.common');
  const user = usePos((state) => state.user);
  const navigate = usePosUi((state) => state.navigate);
  const run = useRunner();
  const [guests, setGuests] = useState<number | null>(DEFAULT_GUESTS);
  const [busy, setBusy] = useState(false);

  async function open() {
    if (busy || guests === null) return;
    setBusy(true);
    const result = await run(() =>
      openOrder({ channel: 'table', tableId: table.id, guestCount: guests }),
    );
    setBusy(false);
    if (!result.ok) return;
    onClose();
    navigate({ name: 'order', orderId: result.value });
  }

  return (
    <form
      className="grid gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void open();
      }}
    >
      <DialogHeader>
        <DialogTitle>{t('title', { label: table.label })}</DialogTitle>
        <DialogDescription>{t('waiter', { name: user?.displayName ?? '' })}</DialogDescription>
      </DialogHeader>
      <NumberStepper label={t('guests')} value={guests} onChange={setGuests} min={1} max={99} />
      <DialogFooter>
        <Button type="button" variant="outline" size="lg" onClick={onClose}>
          {tc('cancel')}
        </Button>
        <Button type="submit" size="lg" disabled={busy || guests === null}>
          {t('open')}
        </Button>
      </DialogFooter>
    </form>
  );
}
