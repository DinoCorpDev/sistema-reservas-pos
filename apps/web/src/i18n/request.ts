import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cookies, headers } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { auth } from '@/auth';
import { isUiLocale, type UiLocale } from './locales';

/**
 * UI language (RF-A08): the signed-in user's own language, independent of the location and the
 * guest; before sign-in, the language chosen on the login page (cookie) or the browser's.
 * No locale in the URL: the backoffice and the POS are not indexed.
 */
async function resolveLocale(): Promise<UiLocale> {
  const session = await auth();
  if (session?.user?.uiLanguage && isUiLocale(session.user.uiLanguage))
    return session.user.uiLanguage;
  const cookieLocale = (await cookies()).get('NEXT_LOCALE')?.value;
  if (cookieLocale && isUiLocale(cookieLocale)) return cookieLocale;
  const accepted = (await headers()).get('accept-language') ?? '';
  for (const part of accepted.split(',')) {
    const candidate = part.trim().slice(0, 2).toLowerCase();
    if (isUiLocale(candidate)) return candidate;
  }
  return 'de';
}

type Messages = { [key: string]: string | Messages };

/** German is the reference catalog; other languages override it key by key. */
function merge(base: Messages, override: Messages): Messages {
  const result: Messages = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = result[key];
    result[key] =
      typeof value === 'object' && typeof current === 'object' ? merge(current, value) : value;
  }
  return result;
}

/**
 * Messages live in `messages/<locale>/<module>.json` (one file per backoffice module) and are
 * merged per locale. Read at request time on the server; files are small.
 */
const cache = new Map<string, Messages>();

function loadLocale(locale: UiLocale): Messages {
  const cached = process.env.NODE_ENV === 'production' ? cache.get(locale) : undefined;
  if (cached) return cached;
  const dir = join(process.cwd(), 'messages', locale);
  let messages: Messages = {};
  const files = existsSync(dir) ? readdirSync(dir) : [];
  for (const file of files.filter((f) => f.endsWith('.json')).sort()) {
    messages = merge(messages, JSON.parse(readFileSync(join(dir, file), 'utf8')) as Messages);
  }
  cache.set(locale, messages);
  return messages;
}

export default getRequestConfig(async () => {
  const locale = await resolveLocale();
  const reference = loadLocale('de');
  const messages = locale === 'de' ? reference : merge(reference, loadLocale(locale));
  return { locale, messages, timeZone: 'Europe/Zurich' };
});
