/**
 * Texts of the device apps (POS and KDS), in the language of the person who unlocked them
 * (RF-A08). They must start without network, so their messages are bundled chunks (precached by
 * the service worker) instead of server-rendered: `messages/<language>/<file>.json`, German as
 * the reference and fallback.
 */

export type Messages = { [key: string]: string | Messages };

/** The files the device apps load; the KDS reuses the shared texts of `pos.json`. */
export type DeviceMessageFile = 'pos' | 'pos-order' | 'pos-payment' | 'pos-cash' | 'kds';

export const DEVICE_LANGUAGES = ['de', 'fr', 'it', 'en', 'es'] as const;
export type DeviceLanguage = (typeof DEVICE_LANGUAGES)[number];

export const asDeviceLanguage = (value: string | null | undefined): DeviceLanguage =>
  (DEVICE_LANGUAGES as readonly string[]).includes(value ?? '') ? (value as DeviceLanguage) : 'de';

/**
 * Before the device knows its location: the language chosen on the start menu (`NEXT_LOCALE`
 * cookie), else the browser's.
 */
export function chosenLanguage(): string {
  if (typeof document === 'undefined') return 'de';
  const cookie = /(?:^|;\s*)NEXT_LOCALE=([a-z]{2})/.exec(document.cookie)?.[1];
  return cookie ?? navigator.language.slice(0, 2);
}

function merge(base: Messages, override: Messages): Messages {
  const result: Messages = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = result[key];
    result[key] =
      typeof value === 'object' && typeof current === 'object' ? merge(current, value) : value;
  }
  return result;
}

async function loadLanguage(
  files: readonly DeviceMessageFile[],
  language: DeviceLanguage,
): Promise<Messages> {
  const parts = await Promise.all(
    files.map((file) =>
      import(
        /* webpackInclude: /[\\/](pos|pos-order|pos-payment|pos-cash|kds)\.json$/ */
        `../../messages/${language}/${file}.json`
      )
        .then((module: { default: Messages }) => module.default)
        .catch(() => ({}) as Messages),
    ),
  );
  return parts.reduce(merge, {});
}

const loaded = new Map<string, Promise<Messages>>();

export function deviceMessages(
  files: readonly DeviceMessageFile[],
  language: DeviceLanguage,
): Promise<Messages> {
  const key = `${files.join(',')}:${language}`;
  let messages = loaded.get(key);
  if (!messages) {
    messages =
      language === 'de'
        ? loadLanguage(files, 'de')
        : Promise.all([loadLanguage(files, 'de'), loadLanguage(files, language)]).then(
            ([de, other]) => merge(de, other),
          );
    loaded.set(key, messages);
  }
  return messages;
}
