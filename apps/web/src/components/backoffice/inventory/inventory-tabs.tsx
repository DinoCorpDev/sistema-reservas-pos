import { cn } from '@pos/ui/utils';
import { BookOpenTextIcon, PackageIcon } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

const TABS = [
  { key: 'ingredients', href: '/backoffice/inventory', icon: PackageIcon },
  { key: 'recipes', href: '/backoffice/inventory/recipes', icon: BookOpenTextIcon },
] as const;

/**
 * Raw materials and recipes are two tabs of one inventory (DEC-053): links styled like the tabs
 * of `@pos/ui`, so each keeps its own address.
 */
export async function InventoryTabs({ current }: { current: (typeof TABS)[number]['key'] }) {
  const t = await getTranslations('inventory.tabs');
  return (
    <nav
      aria-label={t('label')}
      className="mb-6 inline-flex w-full items-center gap-1 overflow-x-auto rounded-xl border bg-muted/70 p-1 text-muted-foreground sm:w-fit"
    >
      {TABS.map(({ key, href, icon: Icon }) => (
        <Link
          key={key}
          href={href}
          aria-current={key === current ? 'page' : undefined}
          className={cn(
            'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3.5 py-1.5 text-sm font-medium whitespace-nowrap transition-[color,background-color,box-shadow] duration-150 hover:text-foreground',
            key === current && 'bg-card text-foreground shadow-card',
          )}
        >
          <Icon className="size-4" aria-hidden />
          {t(key)}
        </Link>
      ))}
    </nav>
  );
}
