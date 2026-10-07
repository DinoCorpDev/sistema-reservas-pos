/**
 * Texts of the POS, in the language of the person who unlocked it (RF-A08). The POS is one
 * client app that must start without network, so its messages are bundled chunks (precached by
 * the service worker) instead of server-rendered: `messages/<language>/pos*.json`, German as
 * the reference and fallback.
 */

type Messages = { [key: string]: string | Messages };

const POS_FILES = ['pos', 'pos-order', 'pos-payment'] as const;
export const POS_LANGUAGES = ['de', 'fr', 'it', 'en', 'es'] as const;
export type PosLanguage = (typeof POS_LANGUAGES)[number];

export const asPosLanguage = (value: string | null | undefined): PosLanguage =>
  (POS_LANGUAGES as readonly string[]).includes(value ?? '') ? (value as PosLanguage) : 'de';

function merge(base: Messages, override: Messages): Messages {
  const result: Messages = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = result[key];
    result[key] =
      typeof value === 'object' && typeof current === 'object' ? merge(current, value) : value;
  }
  return result;
}

async function loadLanguage(language: PosLanguage): Promise<Messages> {
  const parts = await Promise.all(
    POS_FILES.map((file) =>
      import(`../../messages/${language}/${file}.json`)
        .then((module: { default: Messages }) => module.default)
        .catch(() => ({}) as Messages),
    ),
  );
  return parts.reduce(merge, {});
}

const loaded = new Map<PosLanguage, Promise<Messages>>();

export function posMessages(language: PosLanguage): Promise<Messages> {
  let messages = loaded.get(language);
  if (!messages) {
    messages =
      language === 'de'
        ? loadLanguage('de')
        : Promise.all([loadLanguage('de'), loadLanguage(language)]).then(([de, other]) =>
            merge(de, other),
          );
    loaded.set(language, messages);
  }
  return messages;
}
