'use client';

import { ConfirmButton } from '@pos/ui/confirm';
import { toast } from '@pos/ui/toaster';
import { Unplug } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { unpairThisDevice, UnsentOperationsError } from '../actions';

/**
 * Unpairs this cashier POS and brings it back to the pairing code (RF-A06). The till is a
 * personal device: whoever holds it may unpair it (DEC-036). It first sends everything to the
 * cloud and refuses while anything is missing there, so no sale is lost.
 */
export function UnpairButton() {
  const t = useTranslations('pos.unpair');
  const [busy, setBusy] = useState(false);
  return (
    <ConfirmButton
      variant="outline"
      size="icon"
      aria-label={t('button')}
      data-testid="unpair-device"
      disabled={busy}
      title={t('title')}
      description={t('description')}
      confirmLabel={t('confirm')}
      cancelLabel={t('cancel')}
      onConfirm={async () => {
        setBusy(true);
        try {
          await unpairThisDevice();
        } catch (cause) {
          toast.error(
            cause instanceof UnsentOperationsError
              ? t('pending', { count: cause.pending })
              : t('offline'),
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <Unplug />
    </ConfirmButton>
  );
}
