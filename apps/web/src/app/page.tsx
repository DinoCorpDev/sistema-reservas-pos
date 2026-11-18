import { Button } from '@pos/ui/button';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { LanguagePicker } from '@/components/language-picker';
import { setLoginLanguage } from './login/actions';
import { ZitasLogo } from '@/components/brand/zitas-logo';

const MODULES = [
  { key: 'pos', href: '/pos' },
  { key: 'kds', href: '/kds' },
  { key: 'backoffice', href: '/backoffice' },
] as const;

/**
 * The start menu, in the language chosen here or the browser's (RF-A08). The choice is kept in
 * the `NEXT_LOCALE` cookie: the backoffice login and the pairing screens of the POS and the KDS
 * start in it too.
 */
export default async function HomePage() {
  const t = await getTranslations();
  return (
    <main className="mx-auto flex min-h-dvh max-w-4xl flex-col justify-center gap-8 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-4xl font-semibold">
            <span className="sr-only">{t('app.name')}</span>
            <ZitasLogo size="lg" />
          </h1>
          <p className="text-lg text-muted-foreground">{t('app.tagline')}</p>
        </div>
        <LanguagePicker onChange={setLoginLanguage} label={t('nav.language')} />
      </header>
      <nav className="grid gap-4 sm:grid-cols-3">
        {MODULES.map((module) => (
          <Button
            key={module.key}
            asChild
            variant="outline"
            size="pos"
            className="h-auto items-start p-5 text-left"
          >
            <Link href={module.href} data-testid={`start-${module.key}`}>
              <span className="text-lg font-semibold">{t(`home.${module.key}.title`)}</span>
              <span className="text-sm whitespace-normal text-muted-foreground">
                {t(`home.${module.key}.description`)}
              </span>
            </Link>
          </Button>
        ))}
      </nav>
    </main>
  );
}
