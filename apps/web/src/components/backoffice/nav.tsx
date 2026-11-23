'use client';

import { Tooltip } from '@pos/ui/tooltip';
import { cn } from '@pos/ui/utils';
import { SECTIONS } from './nav-items';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { helpLanguageOf } from '@/help/manuals';

export function BackofficeNav({
  permissions,
  onNavigate,
  tone = 'light',
}: {
  permissions: string[];
  onNavigate?: () => void;
  /**
   * `sidebar`: white in the light theme and Deep Intelligence in the dark one (DEC-053);
   * `light` in the mobile menu.
   */
  tone?: 'light' | 'sidebar';
}) {
  const t = useTranslations('nav');
  const th = useTranslations('navHint');
  const ts = useTranslations('navSection');
  const pathname = usePathname();
  const locale = useLocale();
  const allowed = new Set(permissions);
  const isActive = (href: string) => {
    if (href === '/backoffice') return pathname === href;
    // Products live at /backoffice/catalog and /backoffice/catalog/products/[id].
    if (href === '/backoffice/catalog') {
      return pathname === href || pathname.startsWith('/backoffice/catalog/products');
    }
    // Recipes live under the inventory but have their own entry.
    if (href === '/backoffice/inventory') {
      return pathname.startsWith(href) && !pathname.startsWith('/backoffice/inventory/recipes');
    }
    return pathname.startsWith(href);
  };

  return (
    <nav className="grid gap-5">
      {SECTIONS.map(({ key: section, items }) => {
        const visible = items.filter((item) => !item.permission || allowed.has(item.permission));
        if (visible.length === 0) return null;
        return (
          <div key={section} className="grid gap-1.5">
            <p
              className={cn('eyebrow px-3', tone === 'sidebar' && 'dark:text-chrome-foreground/40')}
            >
              {ts(section)}
            </p>
            <ul className="grid gap-0.5">
              {visible.map(({ href, key, icon: Icon, external }) => (
                <li key={href}>
                  {/* What each section is for, while the team learns the backoffice. */}
                  <Tooltip content={th(key)}>
                    <Link
                      href={external ? `${href}/${helpLanguageOf(locale)}/owner` : href}
                      {...(external ? { target: '_blank', rel: 'noopener' } : {})}
                      onClick={onNavigate}
                      aria-current={isActive(href) ? 'page' : undefined}
                      className={cn(
                        'relative flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors duration-150',
                        'text-foreground/80 hover:bg-accent hover:text-foreground',
                        tone === 'sidebar' &&
                          'dark:text-chrome-foreground/70 dark:hover:bg-white/5 dark:hover:text-chrome-foreground',
                        isActive(href) && 'bg-accent font-semibold text-accent-foreground',
                        isActive(href) &&
                          tone === 'sidebar' &&
                          'dark:bg-chrome-accent dark:text-chrome-foreground',
                        // The current page: a teal bar on the left edge.
                        isActive(href) &&
                          'before:absolute before:inset-y-2.5 before:left-0 before:w-[3px] before:rounded-full before:bg-brand',
                      )}
                    >
                      <Icon
                        className={cn(
                          'size-5 shrink-0',
                          isActive(href) ? 'text-brand-strong' : 'text-muted-foreground',
                          tone === 'sidebar' &&
                            (isActive(href) ? 'dark:text-brand' : 'dark:text-chrome-foreground/55'),
                        )}
                      />
                      {t(key)}
                    </Link>
                  </Tooltip>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
