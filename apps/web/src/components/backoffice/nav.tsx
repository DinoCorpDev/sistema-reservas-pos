'use client';

import { Tooltip } from '@pos/ui/tooltip';
import { cn } from '@pos/ui/utils';
import {
  ChartColumnIcon,
  CircleHelpIcon,
  CloudAlertIcon,
  ContactIcon,
  CreditCardIcon,
  FolderTreeIcon,
  KeyRoundIcon,
  LayoutDashboardIcon,
  LayoutGridIcon,
  LifeBuoyIcon,
  ListPlusIcon,
  MonitorSmartphoneIcon,
  PercentIcon,
  ScrollTextIcon,
  StoreIcon,
  type LucideIcon,
  UserCogIcon,
  UsersIcon,
  UtensilsCrossedIcon,
  WalletIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { helpLanguageOf } from '@/help/manuals';

interface NavItem {
  href: string;
  key: string;
  icon: LucideIcon;
  /** Shown only with this permission (the page checks it again on the server). */
  permission?: string;
  /** Opens in a new tab, outside the backoffice (the manuals, RNF-21). */
  external?: boolean;
}

const SECTIONS: NavItem[][] = [
  [
    { href: '/backoffice', key: 'overview', icon: LayoutDashboardIcon },
    { href: '/backoffice/cash', key: 'cash', icon: WalletIcon, permission: 'report.view' },
    {
      href: '/backoffice/reports',
      key: 'reports',
      icon: ChartColumnIcon,
      permission: 'report.view',
    },
  ],
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
    {
      href: '/backoffice/sync-conflicts',
      key: 'syncConflicts',
      icon: CloudAlertIcon,
      permission: 'sync.resolve_conflicts',
    },
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
    { href: '/backoffice/plan', key: 'plan', icon: CreditCardIcon, permission: 'location.manage' },
    { href: '/backoffice/account', key: 'account', icon: UserCogIcon },
    { href: '/help', key: 'help', icon: CircleHelpIcon, external: true },
  ],
];

export function BackofficeNav({
  permissions,
  onNavigate,
  tone = 'light',
}: {
  permissions: string[];
  onNavigate?: () => void;
  /** `dark` in the Deep Intelligence sidebar; `light` in the mobile menu. */
  tone?: 'light' | 'dark';
}) {
  const t = useTranslations('nav');
  const th = useTranslations('navHint');
  const pathname = usePathname();
  const locale = useLocale();
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
                      'flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors',
                      tone === 'dark'
                        ? 'text-chrome-foreground/75 hover:bg-white/5 hover:text-chrome-foreground'
                        : 'hover:bg-accent',
                      isActive(href) &&
                        (tone === 'dark'
                          ? 'bg-chrome-accent text-chrome-foreground'
                          : 'bg-accent text-accent-foreground'),
                    )}
                  >
                    <Icon
                      className={cn(
                        'size-5 shrink-0',
                        isActive(href)
                          ? tone === 'dark'
                            ? 'text-brand'
                            : 'text-brand-strong'
                          : tone === 'dark'
                            ? 'text-chrome-foreground/55'
                            : 'text-muted-foreground',
                      )}
                    />
                    {t(key)}
                  </Link>
                </Tooltip>
              </li>
            ))}
          </ul>
        );
      })}
    </nav>
  );
}
