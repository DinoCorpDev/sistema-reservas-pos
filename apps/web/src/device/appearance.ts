'use client';

import { type Appearance, appearanceCss } from '@pos/core';
import { useEffect } from 'react';
import { APPEARANCE_KEY } from '@/components/theme/theme';
import { usePos } from './store';

/**
 * The restaurant's brand on the till and the kitchen screen (DEC-058). It comes with the
 * bootstrap, so it works offline; the stylesheet is also kept in localStorage, where
 * THEME_SCRIPT finds it before the first paint of /pos and /kds (no flash of the Zitas colours).
 */

const STYLE_ID = 'brand-appearance';

export function applyAppearance(appearance: Appearance | null | undefined): void {
  const css = appearance ? appearanceCss(appearance) : '';
  let style = document.getElementById(STYLE_ID);
  try {
    if (css) window.localStorage.setItem(APPEARANCE_KEY, css);
    else window.localStorage.removeItem(APPEARANCE_KEY);
  } catch {
    // Private mode: the brand still applies, only the first paint shows Zitas.
  }
  if (!css) {
    style?.remove();
    return;
  }
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  if (style.textContent !== css) style.textContent = css;
}

/** Keeps the page's brand in step with the device's configuration; none while unpaired. */
export function useDeviceAppearance(): void {
  const appearance = usePos((state) => state.bootstrap?.organization.appearance);
  const ready = usePos((state) => state.ready);
  useEffect(() => {
    if (ready) applyAppearance(appearance);
  }, [appearance, ready]);
}

/** The logo of the restaurant the device belongs to, if it has one. */
export function useDeviceLogo() {
  return usePos((state) => state.bootstrap?.organization.appearance?.logo ?? null);
}
