'use client';

import { NextIntlClientProvider } from 'next-intl';
import { useEffect, useState } from 'react';
import { configureDevice } from '@/device/app';
import { useDeviceAppearance } from '@/device/appearance';
import { bootDevice } from '@/device/boot';
import { asDeviceLanguage, chosenLanguage, deviceMessages, type Messages } from '@/device/i18n';
import { usePos } from '@/device/store';
import { PairingScreen } from '@/device/ui/pairing-screen';
import { RevokedScreen } from '@/device/ui/revoked-screen';
import { UpdateBanner } from '@/device/ui/update-banner';
import { PinScreen } from '@/device/ui/pin-screen';
import { useChoosableStations } from '../board';
import { KdsShell } from './kds-shell';
import { StationHeading, StationPicker } from './station-picker';

// The KDS reuses the shared texts of the POS (pairing, PIN, status).
const KDS_FILES = ['pos', 'kds'] as const;

/**
 * The kitchen display as one client app, like the POS (DEC-030): it boots from its own local
 * database and works without internet through the hub (RF-C27). A cook unlocks it once with
 * their PIN; it stays unlocked. The screen is in the cook's language (RF-A08); the tickets are in
 * the kitchen language (RF-C25). A display without a fixed station asks for one before the PIN
 * (DEC-042); anyone allowed in the kitchen may work at any station.
 */
export function KdsApp() {
  const ready = usePos((state) => state.ready);
  const device = usePos((state) => state.device);
  const bootstrap = usePos((state) => state.bootstrap);
  const user = usePos((state) => state.user);
  const revoked = usePos((state) => state.revoked);
  const chosenId = usePos((state) => state.kitchenStationId);
  const choosable = useChoosableStations();
  const fixedId = bootstrap?.terminal.kitchenStationId ?? null;
  const station = fixedId
    ? (bootstrap?.stations.find((s) => s.id === fixedId) ?? null)
    : (choosable.find((s) => s.id === chosenId) ?? null);
  const lockLanguage = usePos((state) => state.lockLanguage);
  const language = asDeviceLanguage(
    user?.uiLanguage ?? lockLanguage ?? bootstrap?.location.kitchenLanguage ?? chosenLanguage(),
  );
  const [messages, setMessages] = useState<{ language: string; messages: Messages } | null>(null);

  // The restaurant's colours, fonts and logo (DEC-058), from the stored configuration.
  useDeviceAppearance();

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
      <UpdateBanner />
      {revoked ? (
        <RevokedScreen />
      ) : !device || !bootstrap ? (
        <PairingScreen />
      ) : !user && !station && !fixedId ? (
        <StationPicker stations={choosable} />
      ) : !user ? (
        <PinScreen
          heading={station && <StationHeading name={station.name} canChange={!fixedId} />}
        />
      ) : (
        <KdsShell />
      )}
    </NextIntlClientProvider>
  );
}
