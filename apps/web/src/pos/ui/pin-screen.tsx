'use client';

import { Button } from '@pos/ui/button';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { unlock } from '../pin';
import { usePos } from '../store';
import { NumPad } from './num-pad';
import { StatusIndicator } from './status-indicator';

const MAX_PIN = 6;

/** The PIN alone identifies the person, with or without network (RF-A06, DEC-023). */
export function PinScreen() {
  const t = useTranslations('pos.pin');
  const location = usePos((state) => state.bootstrap?.location.name);
  const terminal = usePos((state) => state.device?.terminalName);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(value = pin) {
    if (value.length < 4 || busy) return;
    setBusy(true);
    setMessage(null);
    const result = await unlock(value);
    setBusy(false);
    setPin('');
    if (result.status === 'wrong') setMessage(t('wrong', { attemptsLeft: result.attemptsLeft }));
    else if (result.status === 'locked')
      setMessage(t('locked', { minutes: Math.ceil(result.retryAfterSeconds / 60) }));
    else if (result.status === 'no_credentials') setMessage(t('noCredentials'));
    else if (result.status === 'invalid') setMessage(t('invalid'));
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-6">
      <div className="flex flex-col items-center gap-1 text-center">
        <p className="text-lg font-semibold">{location}</p>
        <p className="text-sm text-muted-foreground">{terminal}</p>
        <StatusIndicator className="mt-2" />
      </div>
      <h1 className="text-center text-2xl font-semibold">{t('title')}</h1>
      <div
        className="flex justify-center gap-3"
        aria-label={t('entered', { count: pin.length })}
        data-testid="pin-dots"
      >
        {Array.from({ length: Math.max(4, pin.length) }, (_, index) => (
          <span
            key={index}
            className={`size-4 rounded-full border-2 border-foreground ${index < pin.length ? 'bg-foreground' : ''}`}
          />
        ))}
      </div>
      <NumPad
        onDigit={(digit) => setPin((value) => (value.length < MAX_PIN ? value + digit : value))}
        onBackspace={() => setPin((value) => value.slice(0, -1))}
        onClear={() => setPin('')}
      />
      <Button size="lg" onClick={() => void submit()} disabled={pin.length < 4 || busy}>
        {busy ? t('checking') : t('unlock')}
      </Button>
      {message && (
        <p className="text-center text-destructive" role="alert">
          {message}
        </p>
      )}
    </main>
  );
}
