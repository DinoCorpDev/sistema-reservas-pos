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
import { KdsShell } from './kds-shell';

// The KDS reuses the shared texts of the POS (pairing, PIN, status).
const KDS_FILES = ['pos', 'kds'] as const;

/**
 * The kitchen display as one client app, like the POS (DEC-030): it boots from its own local
 * database and works without internet through the hub (RF-C27). A cook unlocks it once with
 * their PIN; it stays unlocked. The screen is in the cook's language (RF-A08); the tickets are in
 * the kitchen language (RF-C25).
 */
export function KdsApp() {
  const ready = usePos((state) => state.ready);
  const device = usePos((state) => state.device);
  const bootstrap = usePos((state) => state.bootstrap);
  const user = usePos((state) => state.user);
  const revoked = usePos((state) => state.revoked);
  const language = asDeviceLanguage(
    user?.uiLanguage ??
      bootstrap?.location.kitchenLanguage ??
      (typeof navigator === 'undefined' ? 'de' : navigator.language.slice(0, 2)),
  );
  const [messages, setMessages] = useState<{ language: string; messages: Messages } | null>(null);

  useEffect(() => {
    configureDevice('kds');
    void bootDevice();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void deviceMessages(KDS_FILES, language).then((loaded) => {
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
      {revoked ? (
        <RevokedScreen />
      ) : !device || !bootstrap ? (
        <PairingScreen />
      ) : !user ? (
        <PinScreen />
      ) : (
        <KdsShell />
      )}
    </NextIntlClientProvider>
  );
}
