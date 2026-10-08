'use client';

import { Button } from '@pos/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pos/ui/card';
import { Input } from '@pos/ui/input';
import { Field } from '@pos/ui/label';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { HubCodeError, pairDevice, PendingElsewhereError } from '../boot';

/**
 * Pairs the device with a code from the backoffice (RF-A06); needs network once. The POS and
 * the kitchen display share it (DEC-030).
 */
export function PairingScreen() {
  const t = useTranslations('pos.pairing');
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <PairingForm />
        </CardContent>
      </Card>
    </main>
  );
}

/** The pairing code field, also on the screen of a deactivated device (DEC-035). */
export function PairingForm() {
  const t = useTranslations('pos.pairing');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await pairDevice(code.trim());
    } catch (cause) {
      const status = (cause as { status?: number }).status;
      setError(
        cause instanceof HubCodeError
          ? t('hubCode')
          : cause instanceof PendingElsewhereError
            ? t('pendingElsewhere', { count: cause.pending })
            : status === 401
              ? t('invalidCode')
              : t('failed'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label={t('code')} htmlFor="pairing-code" error={error ?? undefined}>
        <Input
          id="pairing-code"
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          placeholder="ABCD-EFGH"
          autoComplete="off"
          autoCapitalize="characters"
          className="text-center font-mono text-2xl tracking-widest"
        />
      </Field>
      <Button type="submit" size="lg" disabled={busy || code.trim().length < 8}>
        {busy ? t('pairing') : t('pair')}
      </Button>
    </form>
  );
}
