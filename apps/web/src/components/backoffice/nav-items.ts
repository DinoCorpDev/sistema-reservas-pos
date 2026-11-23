// Shared by the sidebar (client) and the page headers (server): no 'use client' here.
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
  PackageIcon,
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

export interface NavItem {
  href: string;
  key: string;
  icon: LucideIcon;
  /** Shown only with this permission (the page checks it again on the server). */
  permission?: string;
  /** Opens in a new tab, outside the backoffice (the manuals, RNF-21). */
  external?: boolean;
}

/** The sidebar in five labelled groups (DEC-053): the day, the venue, the menu, control, settings. */
export const SECTIONS: { key: string; items: NavItem[] }[] = [
  {
    key: 'operation',
    items: [
      { href: '/backoffice', key: 'overview', icon: LayoutDashboardIcon },
      { href: '/backoffice/cash', key: 'cash', icon: WalletIcon, permission: 'report.view' },
      {
        href: '/backoffice/reports',
        key: 'reports',
        icon: ChartColumnIcon,
        permission: 'report.view',
      },
    ],
  },
  {
    key: 'location',
    items: [
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
  },
  {
    key: 'menu',
    items: [
      { href: '/backoffice/catalog', key: 'products', icon: UtensilsCrossedIcon },
      { href: '/backoffice/catalog/categories', key: 'categories', icon: FolderTreeIcon },
      { href: '/backoffice/catalog/modifiers', key: 'modifiers', icon: ListPlusIcon },
      { href: '/backoffice/tax', key: 'tax', icon: PercentIcon },
      {
        href: '/backoffice/inventory',
        key: 'inventory',
        icon: PackageIcon,
        permission: 'inventory.manage',
      },
    ],
  },
  {
    key: 'control',
    items: [
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
  },
  {
    key: 'settings',
    items: [
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
      {
        href: '/backoffice/plan',
        key: 'plan',
        icon: CreditCardIcon,
        permission: 'location.manage',
      },
      { href: '/backoffice/account', key: 'account', icon: UserCogIcon },
      { href: '/help', key: 'help', icon: CircleHelpIcon, external: true },
    ],
  },
];

/** The menu entry of a page and its section, for the page header (DEC-053). */
export function findNavItem(key: string): (NavItem & { section: string }) | undefined {
  for (const { key: section, items } of SECTIONS) {
    const item = items.find((entry) => entry.key === key);
    if (item) return { ...item, section };
  }
  return undefined;
}
