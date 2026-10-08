'use client';

import {
  type ContentLanguage,
  isContentLanguage,
  KITCHEN_LABELS,
  type KitchenCatalog,
  kitchenCatalog,
  stationBoard,
} from '@pos/core';
import { useEffect, useMemo, useState } from 'react';
import { usePos } from '@/device/store';

/** The current time, refreshed every few seconds for the timers (RF-C24). */
export function useNow(intervalMs = 10_000): string {
  const [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date().toISOString()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** The station of this kitchen display and how it works (RF-C20, RF-C24, RF-C25, RF-C26). */
export function useStation() {
  const bootstrap = usePos((state) => state.bootstrap);
  return useMemo(() => {
    if (!bootstrap) return null;
    const station = bootstrap.stations.find((s) => s.id === bootstrap.terminal.kitchenStationId);
    if (!station) return null;
    const language: ContentLanguage = isContentLanguage(station.language)
      ? station.language
      : isContentLanguage(bootstrap.location.kitchenLanguage)
        ? bootstrap.location.kitchenLanguage
        : 'de';
    const printer =
      bootstrap.printers.find((p) => p.id === station.printerId && p.isActive) ?? null;
    return {
      ...station,
      language,
      alertAfterMinutes:
        station.alertAfterMinutes ?? bootstrap.location.settings.kitchen.alertAfterMinutes,
      printer,
    };
  }, [bootstrap]);
}

/**
 * The board of this station from the fold of every operation the device knows (DEC-029): active
 * tickets oldest first with their timers, and the recall list of the last hours. Names and
 * allergens in the kitchen language of each ticket (RF-C25).
 */
export function useStationBoard(now: string) {
  const fold = usePos((state) => state.fold);
  const foldVersion = usePos((state) => state.foldVersion);
  const catalog = usePos((state) => state.bootstrap?.catalog);
  const station = useStation();

  const catalogs = useMemo(() => {
    const byLanguage = new Map<ContentLanguage, KitchenCatalog>();
    return (language: ContentLanguage) => {
      let found = byLanguage.get(language);
      if (!found && catalog) {
        found = kitchenCatalog(catalog, language);
        byLanguage.set(language, found);
      }
      return found;
    };
  }, [catalog]);

  const board = useMemo(() => {
    if (!station) return null;
    const result = stationBoard(fold, station.id, {
      now,
      alertAfterMinutes: station.alertAfterMinutes,
      catalog: catalogs(station.language),
    });
    return result;
    // foldVersion: the fold is updated in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fold, foldVersion, station, now, catalogs]);

  return { station, board, labels: KITCHEN_LABELS[station?.language ?? 'de'] };
}
