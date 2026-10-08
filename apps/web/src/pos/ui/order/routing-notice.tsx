'use client';

import { UserX } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { usePos } from '@/device/store';
import { planSend } from '../../actions';
import { useNow } from './hooks';
import { useStationName } from './send';

/**
 * Before sending: a station the pending items go to has nobody logged in, so they will go to its
 * replacement (DEC-033). Follows who is at the kitchen displays as the pulls bring it.
 */
export function RoutingNotice({ orderId, pending }: { orderId: string; pending: number }) {
  const t = useTranslations('posOrder.routing');
  const presence = usePos((state) => state.presence);
  const foldVersion = usePos((state) => state.foldVersion);
  const bootstrap = usePos((state) => state.bootstrap);
  const stationName = useStationName();
  // Presence ages even without news (offline): look again every few seconds.
  const now = useNow(5_000);
  const redirected = useMemo(() => {
    if (pending === 0) return [];
    try {
      return planSend(orderId, undefined, () => '').redirected.filter(
        (r) => r.reason === 'nobody_there',
      );
    } catch {
      return [];
    }
    // The plan reads the fold, `presence`, `bootstrap` and the time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, pending, foldVersion, presence, bootstrap, now]);

  if (redirected.length === 0) return null;
  return (
    <div
      className="flex shrink-0 flex-col gap-1 border-t bg-amber-50 px-4 py-2 text-amber-950"
      role="status"
      data-testid="routing-notice"
    >
      {redirected.map((r) => (
        <p key={`${r.fromStationId}>${r.toStationId}`} className="flex items-center gap-2">
          <UserX className="size-4 shrink-0" aria-hidden />
          {t('notice', { from: stationName(r.fromStationId), to: stationName(r.toStationId) })}
        </p>
      ))}
    </div>
  );
}
