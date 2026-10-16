/**
 * Content languages: menu, receipts, kitchen and customer (RF-B07, RF-C25, RF-D23). Spanish is
 * one of them, for restaurants outside Switzerland too (DEC-046).
 */
export const CONTENT_LANGUAGES = ['de', 'fr', 'it', 'en', 'es'] as const;
export type ContentLanguage = (typeof CONTENT_LANGUAGES)[number];

/** UI languages: the same five (RF-A08). */
export const UI_LANGUAGES = CONTENT_LANGUAGES;
export type UiLanguage = (typeof UI_LANGUAGES)[number];

export function isContentLanguage(value: unknown): value is ContentLanguage {
  return typeof value === 'string' && (CONTENT_LANGUAGES as readonly string[]).includes(value);
}
