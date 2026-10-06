'use client';

import { useFormatter } from 'next-intl';

/**
 * Formats an ISO timestamp from the API as a short local date and time (Europe/Zurich, from the
 * i18n config), or returns null when there is none so the caller can show its own placeholder.
 */
export function useDateTime() {
  const format = useFormatter();
  return (iso: string | null | undefined, style: 'datetime' | 'time' = 'datetime') => {
    if (!iso) return null;
    const date = new Date(iso);
    return style === 'time'
      ? format.dateTime(date, { timeStyle: 'short' })
      : format.dateTime(date, { dateStyle: 'short', timeStyle: 'short' });
  };
}
