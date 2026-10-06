/** Content languages: menu, receipts, kitchen and customer (RF-B07, RF-C25, RF-D23). */
export const CONTENT_LANGUAGES = ['de', 'fr', 'it', 'en'] as const;
export type ContentLanguage = (typeof CONTENT_LANGUAGES)[number];

/** UI languages: the content languages plus ES for DINOLABS support (RF-A08). */
export const UI_LANGUAGES = [...CONTENT_LANGUAGES, 'es'] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];

export function isContentLanguage(value: unknown): value is ContentLanguage {
  return typeof value === 'string' && (CONTENT_LANGUAGES as readonly string[]).includes(value);
}
