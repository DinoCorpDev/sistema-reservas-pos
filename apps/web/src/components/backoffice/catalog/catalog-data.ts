import {
  ALLERGENS,
  type Allergen,
  type AllergenPresence,
  CONTENT_LANGUAGES,
  type ContentLanguage,
} from '@pos/core';
import type { KeyboardEvent } from 'react';

/**
 * Shapes the catalog forms work with and their conversion to the use cases' inputs. Pure
 * functions, shared by the product, category and modifier screens.
 */

/** Default courses offered in the forms (RF-B11): 0 drinks, 1 starter, 2 main, 3 dessert. */
export const COURSES = [0, 1, 2, 3] as const;

/** Languages of short labels (variants, modifiers, groups); the catalog text is the main name. */
export const LABEL_LANGUAGES = ['fr', 'it', 'en'] as const satisfies readonly ContentLanguage[];
export type LabelLanguage = (typeof LABEL_LANGUAGES)[number];

/** Weekday bits of an availability rule (RF-B08): Monday = 1 … Sunday = 64. */
export const WEEKDAYS = [
  { key: 'mon', bit: 1 },
  { key: 'tue', bit: 2 },
  { key: 'wed', bit: 4 },
  { key: 'thu', bit: 8 },
  { key: 'fri', bit: 16 },
  { key: 'sat', bit: 32 },
  { key: 'sun', bit: 64 },
] as const;
export const ALL_DAYS = 127;

/** Countries most often declared for meat, poultry and fish in Swiss restaurants (RF-B06). */
export const COMMON_COUNTRIES = [
  'CH',
  'DE',
  'FR',
  'IT',
  'AT',
  'IE',
  'GB',
  'ES',
  'NL',
  'DK',
  'NO',
  'PL',
  'HU',
  'US',
  'AR',
  'UY',
  'BR',
  'AU',
  'NZ',
  'VN',
  'TH',
  'EC',
] as const;

/** Country name in the UI language (`CH` → `Schweiz`), or the code when unknown. */
export function countryName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

// ── Allergens (RF-B05) ──────────────────────────────────────────────────────

export type AllergenMap = Partial<Record<Allergen, AllergenPresence>>;

export function allergenMapOf(
  list: readonly { allergen: string; presence: string }[],
): AllergenMap {
  const map: AllergenMap = {};
  for (const { allergen, presence } of list) {
    if ((ALLERGENS as readonly string[]).includes(allergen)) {
      map[allergen as Allergen] = presence === 'may_contain' ? 'may_contain' : 'contains';
    }
  }
  return map;
}

export const allergenListOf = (map: AllergenMap) =>
  ALLERGENS.flatMap((allergen) => {
    const presence = map[allergen];
    return presence ? [{ allergen, presence }] : [];
  });

// ── Translations (RF-B07) ───────────────────────────────────────────────────

export type TextDraft = Record<ContentLanguage, { name: string; description: string }>;
/** Short labels; the form shows FR, IT and EN, a German label set through the API is kept. */
export type LabelDraft = Record<ContentLanguage, string>;

type TranslationMap = Record<string, { name?: string; description?: string } | undefined>;

export function textDraftOf(map: TranslationMap | undefined): TextDraft {
  const draft = {} as TextDraft;
  for (const language of CONTENT_LANGUAGES) {
    draft[language] = {
      name: map?.[language]?.name ?? '',
      description: map?.[language]?.description ?? '',
    };
  }
  return draft;
}

/** Languages with a description but no name: the use case needs the name. */
export const incompleteLanguages = (draft: TextDraft) =>
  CONTENT_LANGUAGES.filter(
    (language) => !draft[language].name.trim() && draft[language].description.trim(),
  );

/** `{ fr: { name, description } }` for the use case; empty languages are removed. */
export function textTranslationsInput(draft: TextDraft, withDescription = true) {
  const input: Partial<Record<ContentLanguage, { name: string; description?: string | null }>> = {};
  for (const language of CONTENT_LANGUAGES) {
    const name = draft[language].name.trim();
    if (!name) continue;
    input[language] = withDescription
      ? { name, description: draft[language].description.trim() || null }
      : { name };
  }
  return input;
}

export function labelDraftOf(labels: Record<string, string | undefined> | undefined): LabelDraft {
  const draft = {} as LabelDraft;
  for (const language of CONTENT_LANGUAGES) draft[language] = labels?.[language] ?? '';
  return draft;
}

/** `{ fr: 'Menu du jour' }` for nested rows; empty languages are removed. */
export function labelsInput(draft: LabelDraft) {
  const input: Partial<Record<ContentLanguage, string>> = {};
  for (const language of CONTENT_LANGUAGES) {
    const value = draft[language].trim();
    if (value) input[language] = value;
  }
  return input;
}

/** `{ fr: { name } }` for the name-only translations of a modifier group. */
export const nameTranslationsInput = (draft: LabelDraft) =>
  Object.fromEntries(
    Object.entries(labelsInput(draft)).map(([language, name]) => [language, { name }]),
  );

export const filledLabels = (draft: LabelDraft) =>
  CONTENT_LANGUAGES.filter((language) => draft[language].trim() !== '');

// ── Lists ───────────────────────────────────────────────────────────────────

/** Moves the item at `index` one place up (-1) or down (+1). */
export function move<T>(list: readonly T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  if (target < 0 || target >= list.length) return [...list];
  const next = [...list];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

/** Local key for rows that do not have an id yet. */
let keyCounter = 0;
export const newRowKey = () => `new-${(keyCounter += 1)}`;

/**
 * `ChfInput` takes the amount on blur: Enter first commits the amount, then submits the form once
 * the new value is in the state.
 */
export function commitAmountOnEnter(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  const input = event.currentTarget;
  const form = input.form;
  input.blur();
  input.focus();
  setTimeout(() => form?.requestSubmit(), 0);
}
