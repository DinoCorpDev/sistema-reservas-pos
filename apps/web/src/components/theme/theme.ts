/**
 * Light, dark or the device's setting (DEC-049). Kept per device in localStorage: a till by the
 * window and a kitchen display in a dim corner each keep their own. Applied before the page
 * paints (`THEME_SCRIPT`), so there is no flash of the other theme. Without a choice the app is
 * light (DEC-053); "automatic" is stored like the other two.
 */
export const THEMES = ['light', 'dark', 'system'] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_KEY = 'zitas-theme';

/** The restaurant's brand stylesheet kept by a till or a kitchen screen (DEC-058). */
export const APPEARANCE_KEY = 'zitas-appearance';

/**
 * Before the first paint: the theme everywhere, and on /pos and /kds the brand the device keeps
 * (the backoffice paints its own from the server; login and pairing are always Zitas).
 */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_KEY}')||'light';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);if(/^\\/(pos|kds)(\\/|$)/.test(location.pathname)){var c=localStorage.getItem('${APPEARANCE_KEY}');if(c){var s=document.createElement('style');s.id='brand-appearance';s.textContent=c;document.head.appendChild(s);}}}catch(e){}})();`;

export const DEFAULT_THEME: Theme = 'light';

export function storedTheme(): Theme {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return (THEMES as readonly string[]).includes(value ?? '') ? (value as Theme) : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function applyTheme(theme: Theme): void {
  const dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Private mode: the choice lasts for this page only.
  }
  applyTheme(theme);
}
