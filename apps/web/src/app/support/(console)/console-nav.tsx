'use client';

import { cn } from '@pos/ui/utils';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

const LINKS = [
  { key: 'organizations', href: '/support' },
  { key: 'status', href: '/support/status' },
  { key: 'plans', href: '/support/plans' },
] as const;

/** The sections of the support console. */
export function ConsoleNav() {
  const t = useTranslations('supportConsole.nav');
  const pathname = usePathname();
  return (
    <nav className="flex gap-1" aria-label={t('label')}>
      {LINKS.map((link) => {
        const active = pathname === link.href;
        return (
          <Link
            key={link.key}
            href={link.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-chrome-foreground/75 hover:bg-white/10 hover:text-chrome-foreground',
              active &&
                'bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground',
            )}
          >
            {t(link.key)}
          </Link>
        );
      })}
    </nav>
  );
}
