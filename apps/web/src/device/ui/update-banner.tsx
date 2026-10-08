'use client';

import { Button } from '@pos/ui/button';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { activateWaitingWorker } from '../service-worker';

/** How often an open screen asks the server whether a new version of the app exists. */
const UPDATE_CHECK_MS = 15 * 60_000;
/** How often it looks whether a new version finished installing and is waiting. */
const WAITING_CHECK_MS = 10_000;

/**
 * A newer version of the app is installed (docs/SYNC.md §13): one tap takes it. It is on every
 * screen (POS, kitchen display and backoffice), because one open tab of the old version keeps the
 * new one waiting, and screens run for days without anyone reloading them.
 */
export function UpdateBanner() {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    const container = typeof navigator === 'undefined' ? undefined : navigator.serviceWorker;
    if (!container) return;
    let current: ServiceWorkerRegistration | null = null;
    const check = () => setWaiting(Boolean(current?.waiting));
    const onFound = () => current?.installing?.addEventListener('statechange', check);
    void container.getRegistration().then((found) => {
      if (!found) return;
      current = found;
      setRegistration(found);
      found.addEventListener('updatefound', onFound);
      check();
      void found.update().catch(() => undefined);
    });
    const waitingTimer = setInterval(check, WAITING_CHECK_MS);
    const updateTimer = setInterval(
      () => void current?.update().catch(() => undefined),
      UPDATE_CHECK_MS,
    );
    return () => {
      clearInterval(waitingTimer);
      clearInterval(updateTimer);
      current?.removeEventListener('updatefound', onFound);
    };
  }, []);

  if (!waiting || !registration) return null;
  return <Banner onUpdate={() => activateWaitingWorker(registration)} />;
}

/**
 * The banner of every other page (login, backoffice, support, QR). The POS and the kitchen display
 * show their own, in the language of the device (RF-A08).
 */
export function SiteUpdateBanner() {
  const pathname = usePathname();
  if (pathname.startsWith('/pos') || pathname.startsWith('/kds')) return null;
  return <UpdateBanner />;
}

function Banner({ onUpdate }: { onUpdate: () => void }) {
  const t = useTranslations('pos.update');
  return (
    <div
      className="flex items-center justify-between gap-2 bg-sky-50 px-4 py-2 text-sm text-sky-900"
      data-testid="update-banner"
    >
      <span>{t('available')}</span>
      <Button variant="outline" onClick={onUpdate}>
        {t('now')}
      </Button>
    </div>
  );
}
