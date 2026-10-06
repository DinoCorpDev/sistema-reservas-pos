/** UI languages (RF-A08): DE, FR, IT, EN and ES for DINOLABS support. */
export const UI_LOCALES = ['de', 'fr', 'it', 'en', 'es'] as const;
export type UiLocale = (typeof UI_LOCALES)[number];

export const LOCALE_NAMES: Record<UiLocale, string> = {
  de: 'Deutsch',
  fr: 'Français',
  it: 'Italiano',
  en: 'English',
  es: 'Español',
};

export function isUiLocale(value: string): value is UiLocale {
  return (UI_LOCALES as readonly string[]).includes(value);
}
