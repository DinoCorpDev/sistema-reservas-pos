'use client';

import { Button } from '@pos/ui/button';
import { useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';
import { isPhone } from '../app';
import { unlock } from '../pin';
import { usePos } from '../store';
import { TrainingBand } from './training-band';
import { APP_VERSION } from '../version';
import { ErrorDialog } from './error-dialog';
import { LanguageMenu } from './language-menu';
import { NumPad } from './num-pad';
import { StatusIndicator } from './status-indicator';
import { BrandLogo, hasBrandLogo } from '@/components/brand/brand-logo';
import { ZitasLogo } from '@/components/brand/zitas-logo';
import { useDeviceLogo } from '../appearance';

const MAX_PIN = 6;

/**
 * The PIN alone identifies the person, with or without network (RF-A06, DEC-023). `heading` goes
 * above the pad: the kitchen display shows its station there (DEC-042).
 */
export function PinScreen({ heading }: { heading?: ReactNode } = {}) {
  const t = useTranslations('pos.pin');
  const location = usePos((state) => state.bootstrap?.location.name);
  const logo = useDeviceLogo();
  const device = usePos((state) => state.device);
  // A waiter's own phone says whose it is: it keeps no other waiter's PIN (DEC-036).
  const terminal = isPhone(device)
    ? t('phoneOf', { name: device?.ownerName ?? device?.terminalName ?? '' })
    : device?.terminalName;
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(value = pin) {
    if (value.length < 4 || busy) return;
    setBusy(true);
    setMessage(null);
    // Whatever fails (local database, PIN check), the pad never stays busy for good.
    const result = await unlock(value).catch(() => ({ status: 'failed' }) as const);
    setBusy(false);
    setPin('');
    if (result.status === 'failed') setMessage(t('failed'));
    else if (result.status === 'wrong')
      setMessage(t('wrong', { attemptsLeft: result.attemptsLeft }));
    else if (result.status === 'locked')
      setMessage(t('locked', { minutes: Math.ceil(result.retryAfterSeconds / 60) }));
    else if (result.status === 'no_credentials') setMessage(t('noCredentials'));
    else if (result.status === 'not_allowed')
      setMessage(t('notAllowedKitchen', { name: result.displayName }));
    else if (result.status === 'not_owner') setMessage(t('notOwner', { name: result.ownerName }));
    else if (result.status === 'invalid') setMessage(t('invalid'));
    else if (result.status === 'elsewhere')
      setMessage(t('elsewhere', { name: result.displayName, terminal: result.terminalName }));
  }

  return (
    <main className="relative flex min-h-dvh flex-col items-center bg-atmosphere p-4 sm:p-6">
      <div className="absolute inset-x-0 top-0">
        <TrainingBand />
      </div>
      {/* Before the PIN: the language of this screen on this device (RF-A08). */}
      <div className="fixed right-4 top-4">
        <LanguageMenu />
      </div>
      {/* One card in the middle of the screen (DEC-053). */}
      <div className="my-auto flex w-full max-w-sm flex-col gap-5 rounded-3xl border bg-card p-6 shadow-raised">
        <div className="flex flex-col items-center gap-1 text-center">
          {hasBrandLogo(logo) ? (
            <BrandLogo logo={logo} name={location ?? ''} className="mb-3 h-16" />
          ) : (
            <ZitasLogo size="sm" className="mb-3" />
          )}
          <p className="text-lg font-semibold">{location}</p>
          <p className="text-sm text-muted-foreground">{terminal}</p>
          <StatusIndicator className="mt-2" />
        </div>
        {heading}
        <h1 className="text-center font-brand text-2xl font-semibold">{t('title')}</h1>
        <div
          className="flex justify-center gap-3"
          aria-label={t('entered', { count: pin.length })}
          data-testid="pin-dots"
        >
          {Array.from({ length: Math.max(4, pin.length) }, (_, index) => (
            <span
              key={index}
              className={`size-4 rounded-full border-2 transition-colors duration-150 ${index < pin.length ? 'border-brand bg-brand shadow-[0_0_0_4px_var(--glow)]' : 'border-muted-foreground/40'}`}
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
        <p className="text-center text-xs text-muted-foreground" data-testid="app-version">
          v{APP_VERSION}
        </p>
      </div>
      <ErrorDialog
        title={t('errorTitle')}
        message={message}
        okLabel={t('ok')}
        onClose={() => setMessage(null)}
      />
    </main>
  );
}
