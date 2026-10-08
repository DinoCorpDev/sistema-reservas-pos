'use client';

import { NextIntlClientProvider } from 'next-intl';
import { useEffect, useState } from 'react';
import { configureDevice } from '@/device/app';
import { bootDevice } from '@/device/boot';
import { asDeviceLanguage, deviceMessages, type Messages } from '@/device/i18n';
import { usePos } from '@/device/store';
import { PairingScreen } from '@/device/ui/pairing-screen';
import { RevokedScreen } from '@/device/ui/revoked-screen';
import { PinScreen } from '@/device/ui/pin-screen';
import { UpdateBanner } from '@/device/ui/update-banner';
import { PosShell } from './pos-shell';

const POS_FILES = ['pos', 'pos-order', 'pos-payment'] as const;

/**
 * The POS as one client app (docs/SYNC.md §13): it boots from the local database, so it opens
 * and works without network. The language is that of the person who unlocked it (RF-A08);
 * before that, the location's language.
 */
export function PosApp() {
  const ready = usePos((state) => state.ready);
  const device = usePos((state) => state.device);
  const bootstrap = usePos((state) => state.bootstrap);
  const user = usePos((state) => state.user);
  const revoked = usePos((state) => state.revoked);
  const language = asDeviceLanguage(
    user?.uiLanguage ??
      bootstrap?.location.defaultLanguage ??
      (typeof navigator === 'undefined' ? 'de' : navigator.language.slice(0, 2)),
  );
  const [messages, setMessages] = useState<{ language: string; messages: Messages } | null>(null);

  useEffect(() => {
    configureDevice('pos');
    void bootDevice();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void deviceMessages(POS_FILES, language).then((loaded) => {
      if (!cancelled) setMessages({ language, messages: loaded });
    });
    document.documentElement.lang = language;
    return () => {
      cancelled = true;
    };
  }, [language]);

  if (!ready || !messages) {
    return <main className="flex min-h-dvh items-center justify-center" aria-busy="true" />;
  }
  return (
    <NextIntlClientProvider
      locale={messages.language}
      messages={messages.messages}
      timeZone={bootstrap?.location.timezone ?? 'Europe/Zurich'}
    >
      <UpdateBanner />
      {revoked ? (
        <RevokedScreen />
      ) : !device || !bootstrap ? (
        <PairingScreen />
      ) : !user ? (
        <PinScreen />
      ) : (
        <PosShell />
      )}
    </NextIntlClientProvider>
  );
}
