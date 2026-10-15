'use client';

import { Button } from '@pos/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pos/ui/card';
import { Input } from '@pos/ui/input';
import { Field } from '@pos/ui/label';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import {
  HubCodeError,
  PendingElsewhereError,
  PinRequiredError,
  pairDevice,
  phonePairingRefusal,
} from '../boot';
import { ErrorDialog } from './error-dialog';
import { NumPad } from './num-pad';

const MAX_PIN = 6;

/**
 * Pairs the device with a code from the backoffice (RF-A06); needs network once. The POS and
 * the kitchen display share it (DEC-030).
 */
export function PairingScreen() {
  const t = useTranslations('pos.pairing');
  const [pinStep, setPinStep] = useState(false);
  return (
    // On a phone the card takes the whole screen (DEC-036).
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6 max-sm:justify-start max-sm:p-0">
      <Card className="max-sm:min-h-dvh max-sm:rounded-none max-sm:border-0 max-sm:shadow-none">
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          {!pinStep && <CardDescription>{t('description')}</CardDescription>}
        </CardHeader>
        <CardContent>
          <PairingForm onPinStep={setPinStep} />
        </CardContent>
      </Card>
    </main>
  );
}

/**
 * The pairing code field, also on the screen of a deactivated device (DEC-035). A code for a
 * waiter's own phone then asks for the waiter's PIN, and the QR of the cashier POS opens
 * `/pos?phone=<code>` straight at that step (DEC-036).
 */
export function PairingForm({ onPinStep }: { onPinStep?: (pinStep: boolean) => void } = {}) {
  const t = useTranslations('pos.pairing');
  const [code, setCode] = useState('');
  /** null: the code step; a string: the waiter's PIN being typed. */
  const [pin, setPin] = useState<string | null>(null);
  const pinStep = pin !== null;
  useEffect(() => onPinStep?.(pinStep), [pinStep, onPinStep]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The terminal of the code runs on another device (DEC-041): no place here, back to `/`. */
  const [noPlace, setNoPlace] = useState(false);

  useEffect(() => {
    const fromQr = new URLSearchParams(window.location.search).get('phone');
    if (!fromQr) return;
    // The code leaves the address bar: a reload or a shared screenshot does not show it.
    window.history.replaceState(null, '', window.location.pathname);
    setCode(fromQr.toUpperCase());
    setPin('');
  }, []);

  async function pair(withPin?: string) {
    setBusy(true);
    setError(null);
    setNoPlace(false);
    try {
      await pairDevice(code.trim(), withPin);
    } catch (cause) {
      if (cause instanceof PinRequiredError) {
        setPin('');
        return;
      }
      const reason = phonePairingRefusal(cause);
      const status = (cause as { status?: number }).status;
      const attemptsLeft =
        (cause as { details?: { attemptsLeft?: number } }).details?.attemptsLeft ?? 0;
      // A dead or expired code needs a new one: back to the code step.
      const codeGone = status === 401 && (reason !== 'wrong_pin' || attemptsLeft === 0);
      setPin(withPin === undefined || codeGone ? null : '');
      if (reason === 'already_paired') {
        const name = (cause as { details?: { name?: string } }).details?.name ?? code.trim();
        setNoPlace(true);
        setError(t('alreadyPaired', { name }));
        return;
      }
      setError(
        cause instanceof HubCodeError
          ? t('hubCode')
          : cause instanceof PendingElsewhereError
            ? t('pendingElsewhere', { count: cause.pending })
            : reason === 'wrong_pin'
              ? attemptsLeft > 0
                ? t('wrongPin', { attemptsLeft })
                : t('codeUsedUp')
              : reason === 'not_waiter'
                ? t('notWaiter')
                : reason === 'phone_deactivated'
                  ? t('phoneDeactivated')
                  : reason === 'plan_limit' ||
                      reason === 'plan_feature' ||
                      reason === 'subscription_suspended'
                    ? t('planLimit')
                    : status === 401
                      ? t('invalidCode')
                      : t('failed'),
      );
    } finally {
      setBusy(false);
    }
  }

  // Every pairing problem shows in a modal that cannot be missed.
  const errorDialog = (
    <ErrorDialog
      title={noPlace ? t('alreadyPairedTitle') : t('errorTitle')}
      message={error}
      okLabel={noPlace ? t('backToStart') : t('ok')}
      onClose={noPlace ? () => window.location.assign('/') : () => setError(null)}
    />
  );

  if (pin !== null) {
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void pair(pin);
        }}
        className="flex flex-col gap-4"
        data-testid="phone-pin-step"
      >
        <div className="text-center">
          <p className="text-lg font-semibold">{t('pinTitle')}</p>
          <p className="text-sm text-muted-foreground">{t('pinDescription')}</p>
        </div>
        <div
          className="flex justify-center gap-3"
          aria-label={t('pinEntered', { count: pin.length })}
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
          onDigit={(digit) =>
            setPin((value) => (value !== null && value.length < MAX_PIN ? value + digit : value))
          }
          onBackspace={() => setPin((value) => (value ? value.slice(0, -1) : value))}
          onClear={() => setPin('')}
        />
        {errorDialog}
        <Button type="submit" size="lg" disabled={busy || pin.length < 4}>
          {busy ? t('pairing') : t('pair')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setPin(null);
            setError(null);
          }}
        >
          {t('otherCode')}
        </Button>
      </form>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void pair();
      }}
      className="flex flex-col gap-4"
    >
      {errorDialog}
      <Field label={t('code')} htmlFor="pairing-code">
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
