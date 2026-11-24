import { ChefHatIcon, ReceiptTextIcon, WifiOffIcon } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { ZitasLogo } from '@/components/brand/zitas-logo';
import { LanguagePicker } from '@/components/language-picker';
import { ThemeToggle } from '@/components/theme/theme-menu';

/** Film grain for the brand panel: SVG noise as a data URI, no request, works offline. */
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

/**
 * The sign-in screens (backoffice and DINOLABS support), DEC-053: on desktop a Deep Intelligence
 * brand panel with what Zitas does, and the form on the right; on a phone, the form alone.
 */
export async function AuthShell({
  title,
  subtitle,
  children,
  footer,
  onLanguageChange,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: { href: string; label: string };
  onLanguageChange: (language: string) => Promise<unknown>;
}) {
  const t = await getTranslations();
  const features = [
    { icon: WifiOffIcon, text: t('auth.featureOffline') },
    { icon: ChefHatIcon, text: t('auth.featureKitchen') },
    { icon: ReceiptTextIcon, text: t('auth.featureTax') },
  ];
  return (
    <main className="grid min-h-dvh grid-cols-1 bg-background lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <section className="relative hidden overflow-hidden bg-chrome p-12 text-chrome-foreground lg:flex lg:flex-col lg:justify-between">
        {/* Atmosphere: teal light from two corners, the brand's large dot, a little grain. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(900px 520px at 85% 0%, rgb(32 184 189 / 28%), transparent 65%), radial-gradient(700px 480px at 0% 100%, rgb(32 184 189 / 14%), transparent 60%)',
          }}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute -right-28 -bottom-28 size-96 rounded-full bg-brand/90 blur-[1px]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07] mix-blend-overlay"
          style={{ backgroundImage: GRAIN }}
        />
        <p className="relative">
          <span className="sr-only">{t('app.name')}</span>
          <ZitasLogo onDark />
        </p>
        <div className="relative grid max-w-lg gap-8">
          <div className="grid gap-4">
            <p className="eyebrow text-brand">{t('auth.brandEyebrow')}</p>
            <p className="font-brand text-5xl leading-[1.05] font-semibold tracking-tight text-balance">
              {t('auth.brandTitle')}
            </p>
            <p className="text-lg text-pretty text-chrome-foreground/70">{t('auth.brandText')}</p>
          </div>
          <ul className="grid gap-3">
            {features.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-chrome-foreground/85">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/5 text-brand">
                  <Icon className="size-[18px]" aria-hidden />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm text-chrome-foreground/45">{t('auth.brandFooter')}</p>
      </section>

      <section className="flex min-h-dvh flex-col bg-atmosphere p-6 sm:p-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="lg:invisible">
            <span className="sr-only">{t('app.name')}</span>
            <ZitasLogo />
          </p>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <LanguagePicker onChange={onLanguageChange} label={t('nav.language')} />
          </div>
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8 py-10">
          <div className="grid gap-2">
            <h1 className="font-brand text-3xl font-semibold tracking-tight">{title}</h1>
            <p className="text-muted-foreground">{subtitle}</p>
          </div>
          {children}
          <Link
            href={footer.href}
            className="text-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            {footer.label}
          </Link>
        </div>
      </section>
    </main>
  );
}
