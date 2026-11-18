import { Button } from '@pos/ui/button';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { LanguagePicker } from '@/components/language-picker';
import { setLoginLanguage } from './login/actions';
import { ZitasLogo } from '@/components/brand/zitas-logo';
import { ChefHatIcon, LayoutDashboardIcon, StoreIcon } from 'lucide-react';
import { ThemeMenu } from '@/components/theme/theme-menu';

const MODULES = [
  { key: 'pos', href: '/pos', icon: StoreIcon },
  { key: 'kds', href: '/kds', icon: ChefHatIcon },
  { key: 'backoffice', href: '/backoffice', icon: LayoutDashboardIcon },
] as const;

/**
 * The start menu, in the language chosen here or the browser's (RF-A08). The choice is kept in
 * the `NEXT_LOCALE` cookie: the backoffice login and the pairing screens of the POS and the KDS
 * start in it too.
 */
export default async function HomePage() {
  const t = await getTranslations();
  return (
    <main className="mx-auto flex min-h-dvh max-w-4xl flex-col justify-center gap-6 p-6">
      <header className="relative overflow-hidden rounded-3xl bg-chrome p-8 text-chrome-foreground sm:p-10">
        {/* The brand's dot, large, as in the brandbook's covers. */}
        <span
          aria-hidden
          className="absolute -right-10 -bottom-16 size-56 rounded-full bg-brand/90 blur-[1px]"
        />
        <span aria-hidden className="absolute bottom-10 left-[58%] size-5 rounded-full bg-brand" />
        <div className="relative flex flex-wrap items-start justify-between gap-6">
          <div className="space-y-4">
            <h1 className="text-4xl font-semibold">
              <span className="sr-only">{t('app.name')}</span>
              <ZitasLogo size="lg" onDark />
            </h1>
            <p className="max-w-md font-brand text-xl text-chrome-foreground/85">
              {t('app.tagline')}
            </p>
          </div>
          <div className="text-foreground">
            <div className="flex items-center gap-2">
              <ThemeMenu />
              <LanguagePicker onChange={setLoginLanguage} label={t('nav.language')} />
            </div>
          </div>
        </div>
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
              <span className="mb-2 flex size-12 items-center justify-center rounded-2xl bg-brand-soft text-brand-strong">
                <module.icon className="size-6" />
              </span>
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
