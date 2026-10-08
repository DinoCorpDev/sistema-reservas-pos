'use client';

import type { FoldState } from '@pos/core';
import { useSyncExternalStore } from 'react';
import { usePos } from '@/device/store';

/**
 * The orders of the location, re-rendering on every change. The fold is updated in place, so
 * the component subscribes to `foldVersion` and reads the (same) fold object on each render.
 */
export function useFold(): FoldState {
  usePos((state) => state.foldVersion);
  return usePos((state) => state.fold);
}

/** Same breakpoint as Tailwind `md`: from there the on-screen keypad is shown. */
const KEYPAD_QUERY = '(min-width: 768px)';

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(KEYPAD_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/**
 * Whether the on-screen keypad is visible. With it, amount inputs open no system keyboard
 * (`inputMode="none"`), which would cover half of a tablet; on a phone the keypad is hidden and
 * the numeric system keyboard is used instead.
 */
export function useKeypadVisible(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(KEYPAD_QUERY).matches,
    () => true,
  );
}
