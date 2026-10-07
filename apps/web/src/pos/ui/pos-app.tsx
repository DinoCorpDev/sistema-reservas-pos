'use client';

import { NextIntlClientProvider } from 'next-intl';
import { useEffect, useState } from 'react';
import { bootPos } from '../boot';
import { asPosLanguage, posMessages } from '../i18n';
import { usePos } from '../store';
import { PairingScreen } from './pairing-screen';
import { PinScreen } from './pin-screen';
import { PosShell } from './pos-shell';

type Messages = Awaited<ReturnType<typeof posMessages>>;

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
  const language = asPosLanguage(
    user?.uiLanguage ??
      bootstrap?.location.defaultLanguage ??
      (typeof navigator === 'undefined' ? 'de' : navigator.language.slice(0, 2)),
  );
  const [messages, setMessages] = useState<{ language: string; messages: Messages } | null>(null);

  useEffect(() => {
    void bootPos();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void posMessages(language).then((loaded) => {
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
      {!device || !bootstrap ? <PairingScreen /> : !user ? <PinScreen /> : <PosShell />}
    </NextIntlClientProvider>
  );
}
