'use client';

import type { Redirect } from '@pos/core';
import { toast } from '@pos/ui/toaster';
import { useTranslations } from 'next-intl';
import { useCallback } from 'react';
import { usePos } from '@/device/store';
import { planSend, sendItems } from '../../actions';
import { confirmRedirects } from '../../ui-store';
import { type RunResult, useRunner } from './run';

/** Station names of the location, by id (unknown ones show as "?"). */
export function useStationName() {
  const stations = usePos((state) => state.bootstrap?.stations);
  return useCallback(
    (id: string) => stations?.find((station) => station.id === id)?.name ?? '?',
    [stations],
  );
}

/**
 * Sends to the kitchen (RF-C21). When nobody is logged in at a station the items go to, the
 * waiter confirms first that they go to its replacement (DEC-033); afterwards a notice says what
 * went elsewhere. Resolves to `{ ok: false }` when it failed or the waiter cancelled.
 */
export function useSend() {
  const t = useTranslations('posOrder.routing');
  const run = useRunner();
  const stationName = useStationName();
  return useCallback(
    async (
      orderId: string,
      course?: number,
    ): Promise<RunResult<{ count: number; redirected: Redirect[] }>> => {
      // Planned in the queue: a product tapped just before is part of the send.
      const preview = await run(async () => planSend(orderId, course));
      if (!preview.ok) return preview;
      const unattended = preview.value.redirected.filter((r) => r.reason === 'nobody_there');
      if (unattended.length > 0 && !(await confirmRedirects(unattended))) return { ok: false };
      // What the waiter confirmed is what is sent, even if someone logged in meanwhile.
      const result = await run(() =>
        sendItems(orderId, course, unattended.length > 0 ? preview.value : undefined),
      );
      if (result.ok) {
        for (const redirect of result.value.redirected) {
          toast.info(
            t('sent', {
              count: redirect.itemIds.length,
              from: stationName(redirect.fromStationId),
              to: stationName(redirect.toStationId),
            }),
          );
        }
      }
      return result;
    },
    [run, stationName, t],
  );
}
