'use client';

import { cn } from '@pos/ui/utils';
import {
  ContactIcon,
  FolderTreeIcon,
  KeyRoundIcon,
  LayoutDashboardIcon,
  LayoutGridIcon,
  LifeBuoyIcon,
  ListPlusIcon,
  type LucideIcon,
  MonitorSmartphoneIcon,
  PercentIcon,
  ScrollTextIcon,
  StoreIcon,
  UserCogIcon,
  UsersIcon,
  UtensilsCrossedIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

interface NavItem {
  href: string;
  key: string;
  icon: LucideIcon;
  /** Shown only with this permission (the page checks it again on the server). */
  permission?: string;
}

const SECTIONS: NavItem[][] = [
  [{ href: '/backoffice', key: 'overview', icon: LayoutDashboardIcon }],
  [
    { href: '/backoffice/location', key: 'location', icon: StoreIcon },
    { href: '/backoffice/floor', key: 'floor', icon: LayoutGridIcon },
    {
      href: '/backoffice/devices',
      key: 'devices',
      icon: MonitorSmartphoneIcon,
      permission: 'location.manage',
    },
    { href: '/backoffice/users', key: 'users', icon: UsersIcon, permission: 'user.manage' },
  ],
  [
    { href: '/backoffice/catalog', key: 'products', icon: UtensilsCrossedIcon },
    { href: '/backoffice/catalog/categories', key: 'categories', icon: FolderTreeIcon },
    { href: '/backoffice/catalog/modifiers', key: 'modifiers', icon: ListPlusIcon },
    { href: '/backoffice/tax', key: 'tax', icon: PercentIcon },
  ],
  [
    {
      href: '/backoffice/customers',
      key: 'customers',
      icon: ContactIcon,
      permission: 'customer.manage',
    },
    { href: '/backoffice/audit', key: 'audit', icon: ScrollTextIcon, permission: 'audit.view' },
  ],
  [
    {
      href: '/backoffice/settings/support',
      key: 'supportAccess',
      icon: LifeBuoyIcon,
      permission: 'support.grant_access',
    },
    {
      href: '/backoffice/settings/api-keys',
      key: 'apiKeys',
      icon: KeyRoundIcon,
      permission: 'user.manage',
    },
    { href: '/backoffice/account', key: 'account', icon: UserCogIcon },
  ],
];

export function BackofficeNav({
  permissions,
  onNavigate,
}: {
  permissions: string[];
  onNavigate?: () => void;
}) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const allowed = new Set(permissions);
  const isActive = (href: string) => {
    if (href === '/backoffice') return pathname === href;
    // Products live at /backoffice/catalog and /backoffice/catalog/products/[id].
    if (href === '/backoffice/catalog') {
      return pathname === href || pathname.startsWith('/backoffice/catalog/products');
    }
    return pathname.startsWith(href);
  };

  return (
    <nav className="grid gap-4">
      {SECTIONS.map((items, index) => {
        const visible = items.filter((item) => !item.permission || allowed.has(item.permission));
        if (visible.length === 0) return null;
        return (
          <ul key={index} className="grid gap-1">
            {visible.map(({ href, key, icon: Icon }) => (
              <li key={href}>
                <Link
                  href={href}
                  onClick={onNavigate}
                  aria-current={isActive(href) ? 'page' : undefined}
                  className={cn(
                    'flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors hover:bg-accent',
                    isActive(href) && 'bg-accent text-accent-foreground',
                  )}
                >
                  <Icon className="size-5 shrink-0 text-muted-foreground" />
                  {t(key)}
                </Link>
              </li>
            ))}
          </ul>
        );
      })}
    </nav>
  );
}
