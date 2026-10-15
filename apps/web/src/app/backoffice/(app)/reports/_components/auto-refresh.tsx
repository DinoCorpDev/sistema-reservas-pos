'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Reloads the server data of the page every `seconds` while the tab is visible (RF-F10). */
export function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, seconds * 1000);
    return () => clearInterval(timer);
  }, [router, seconds]);
  return null;
}
