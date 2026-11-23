import { IconTile } from '@pos/ui/card';
import {
  ArrowUpRightIcon,
  ChartColumnIcon,
  MonitorSmartphoneIcon,
  type LucideIcon,
  UsersIcon,
  UtensilsCrossedIcon,
} from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

const ACTIONS: { key: string; href: string; icon: LucideIcon; permission?: string }[] = [
  { key: 'products', href: '/backoffice/catalog', icon: UtensilsCrossedIcon },
  {
    key: 'devices',
    href: '/backoffice/devices',
    icon: MonitorSmartphoneIcon,
    permission: 'location.manage',
  },
  { key: 'staff', href: '/backoffice/users', icon: UsersIcon, permission: 'user.manage' },
  { key: 'reports', href: '/backoffice/reports', icon: ChartColumnIcon, permission: 'report.view' },
];

/** The four places people go most from the overview, as large tiles (DEC-053). */
export async function QuickActions({ permissions }: { permissions: ReadonlySet<string> }) {
  const t = await getTranslations('overview.quick');
  const visible = ACTIONS.filter((a) => !a.permission || permissions.has(a.permission));
  if (visible.length === 0) return null;
  return (
    <section className="mb-8 grid gap-3" aria-labelledby="quick-actions">
      <h2 id="quick-actions" className="eyebrow">
        {t('title')}
      </h2>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {visible.map(({ key, href, icon: Icon }) => (
          <li key={key}>
            <Link
              href={href}
              className="group flex h-full items-start gap-3 rounded-xl border bg-card p-4 shadow-card transition-[box-shadow,border-color,transform] duration-150 hover:-translate-y-px hover:border-brand/40 hover:shadow-raised focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <IconTile>
                <Icon />
              </IconTile>
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="font-medium">{t(`${key}.title`)}</span>
                <span className="text-sm text-muted-foreground">{t(`${key}.text`)}</span>
              </span>
              <ArrowUpRightIcon
                aria-hidden
                className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-brand-strong"
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
