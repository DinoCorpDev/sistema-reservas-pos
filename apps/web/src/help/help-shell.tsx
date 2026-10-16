import { cn } from '@pos/ui/utils';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { PrintButton } from '@/components/print-button';
import {
  HELP_CHROME,
  HELP_LANGUAGES,
  HELP_ROLES,
  type HelpLanguage,
  type HelpRole,
} from './manuals';

const LANGUAGE_NAMES: Record<HelpLanguage, string> = { de: 'Deutsch', es: 'Español' };

/** Header of the manuals: the roles, the language and printing (RNF-21). */
export function HelpShell({
  lang,
  role,
  children,
}: {
  lang: HelpLanguage;
  role: HelpRole | null;
  children: ReactNode;
}) {
  const chrome = HELP_CHROME[lang];
  return (
    <main lang={lang} className="mx-auto grid max-w-3xl gap-6 px-4 py-6 print:max-w-none">
      <header className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">
            <Link href={`/help/${lang}`}>{chrome.title}</Link>
          </h1>
          <div className="flex items-center gap-2 print:hidden">
            <nav aria-label={chrome.language} className="flex gap-1">
              {HELP_LANGUAGES.map((code) => (
                <Link
                  key={code}
                  href={role ? `/help/${code}/${role}` : `/help/${code}`}
                  lang={code}
                  aria-current={code === lang ? 'true' : undefined}
                  className={cn(
                    'flex min-h-11 items-center rounded-lg px-3 text-sm font-medium hover:bg-accent',
                    code === lang && 'bg-accent',
                  )}
                >
                  {LANGUAGE_NAMES[code]}
                </Link>
              ))}
            </nav>
            {role ? <PrintButton label={chrome.print} /> : null}
          </div>
        </div>
        <nav className="flex flex-wrap gap-1 print:hidden" aria-label={chrome.title}>
          {HELP_ROLES.map((key) => (
            <Link
              key={key}
              href={`/help/${lang}/${key}`}
              aria-current={key === role ? 'page' : undefined}
              className={cn(
                'flex min-h-11 items-center rounded-lg border px-3 text-sm font-medium hover:bg-accent',
                key === role &&
                  'border-primary bg-primary text-primary-foreground hover:bg-primary',
              )}
            >
              {chrome.roles[key]}
            </Link>
          ))}
        </nav>
      </header>
      {children}
    </main>
  );
}
