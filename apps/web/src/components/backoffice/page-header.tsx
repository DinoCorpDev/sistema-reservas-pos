import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { findNavItem } from './nav-items';

/**
 * Page title block (DEC-053): an icon tile and the section label above the title, a one-line
 * description, and the page's main actions on the right. `nav` names the page's menu entry and
 * brings both from the sidebar, so every page matches its place in the menu; `icon` and
 * `eyebrow` override them.
 */
export function PageHeader({
  title,
  description,
  actions,
  nav,
  icon,
  eyebrow,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  nav?: string;
  icon?: ReactNode;
  eyebrow?: string;
}) {
  const t = useTranslations('navSection');
  const entry = nav ? findNavItem(nav) : undefined;
  const Icon = entry?.icon;
  const tile = icon ?? (Icon ? <Icon /> : null);
  const label = eyebrow ?? (entry ? t(entry.section) : undefined);
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 items-start gap-4">
        {tile ? (
          <span
            aria-hidden
            className="hidden size-12 shrink-0 place-items-center rounded-xl border bg-card text-brand-strong shadow-card sm:grid [&_svg]:size-6"
          >
            {tile}
          </span>
        ) : null}
        <div className="grid min-w-0 gap-1">
          {label ? <p className="eyebrow">{label}</p> : null}
          <h1 className="font-brand text-3xl leading-tight font-semibold tracking-tight text-balance">
            {title}
          </h1>
          {description ? (
            <p className="max-w-2xl text-pretty text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
