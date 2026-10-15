'use client';

import { cn } from '@pos/ui/utils';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

const TABS = [
  { key: 'sales', href: '/backoffice/reports' },
  { key: 'vat', href: '/backoffice/reports/vat' },
  { key: 'tips', href: '/backoffice/reports/tips' },
  { key: 'adjustments', href: '/backoffice/reports/adjustments' },
  { key: 'times', href: '/backoffice/reports/times' },
  { key: 'export', href: '/backoffice/reports/export' },
] as const;

/** The reports of the section; switching keeps the period chosen. */
export function ReportTabs() {
  const t = useTranslations('reports.tabs');
  const title = useTranslations('reports')('title');
  const pathname = usePathname();
  const params = useSearchParams();
  const period = new URLSearchParams();
  for (const key of ['from', 'to']) {
    const value = params.get(key);
    if (value) period.set(key, value);
  }
  const query = period.toString();
  return (
    <nav className="mb-4 flex gap-1 overflow-x-auto border-b print:hidden" aria-label={title}>
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.key}
            href={query ? `${tab.href}?${query}` : tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex min-h-11 shrink-0 items-center border-b-2 px-3 text-sm font-medium whitespace-nowrap transition-colors',
              active
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t(tab.key)}
          </Link>
        );
      })}
    </nav>
  );
}
