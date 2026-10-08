'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pos/ui/card';
import { Unplug } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { unconfirmedCount } from '../db';
import { usePos } from '../store';
import { PairingForm } from './pairing-screen';

/**
 * The device was deactivated or unpaired in the backoffice (RF-A12, DEC-035): no tables, no
 * orders, no kitchen board until a new pairing code. What was not sent yet stays on the device
 * and goes out once it is paired again at the same location.
 */
export function RevokedScreen() {
  const t = useTranslations('pos.revoked');
  const name = usePos((state) => state.device?.terminalName);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    void unconfirmedCount().then(setPending);
  }, []);

  return (
    <main
      className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6"
      data-testid="device-revoked"
    >
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Unplug className="size-6 text-destructive" aria-hidden /> {t('title')}
          </CardTitle>
          <CardDescription>{t('description', { name: name ?? '' })}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {pending > 0 && (
            <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-950" role="status">
              {t('pending', { count: pending })}
            </p>
          )}
          <PairingForm />
        </CardContent>
      </Card>
    </main>
  );
}
