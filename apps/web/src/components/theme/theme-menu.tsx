'use client';

import { Button } from '@pos/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@pos/ui/dropdown-menu';
import { cn } from '@pos/ui/utils';
import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { applyTheme, DEFAULT_THEME, saveTheme, storedTheme, type Theme, THEMES } from './theme';

const ICONS = { light: SunIcon, dark: MoonIcon, system: MonitorIcon } as const;

/** Light, dark or automatic (the device's setting), for this device (DEC-049). */
export function ThemeMenu({ className }: { className?: string }) {
  const t = useTranslations('pos.theme');
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);

  useEffect(() => {
    setTheme(storedTheme());
  }, []);

  // «Automatic» follows the device when it switches between day and night.
  useEffect(() => {
    if (theme !== 'system') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const follow = () => applyTheme('system');
    query.addEventListener('change', follow);
    return () => query.removeEventListener('change', follow);
  }, [theme]);

  const Icon = ICONS[theme];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className={cn(className)}
          aria-label={t('label')}
          title={t('label')}
          data-testid="theme-menu"
        >
          <Icon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(value) => {
            const next = value as Theme;
            setTheme(next);
            saveTheme(next);
          }}
        >
          {THEMES.map((option) => {
            const OptionIcon = ICONS[option];
            return (
              <DropdownMenuRadioItem key={option} value={option}>
                <OptionIcon className="size-4" /> {t(option)}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The visible switch of the backoffice and the sign-in (DEC-053): light and dark side by side, so
 * nobody has to guess that a theme exists. "Automatic" stays in the POS and KDS menu.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const t = useTranslations('pos.theme');
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);
  const [systemDark, setSystemDark] = useState(false);

  useEffect(() => {
    setTheme(storedTheme());
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemDark(query.matches);
    const follow = () => {
      setSystemDark(query.matches);
      if (storedTheme() === 'system') applyTheme('system');
    };
    query.addEventListener('change', follow);
    return () => query.removeEventListener('change', follow);
  }, []);

  const dark = theme === 'dark' || (theme === 'system' && systemDark);
  const choose = (next: 'light' | 'dark') => {
    setTheme(next);
    saveTheme(next);
  };
  return (
    <div
      role="group"
      aria-label={t('label')}
      data-testid="theme-toggle"
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full border bg-card p-0.5 shadow-xs',
        className,
      )}
    >
      {(['light', 'dark'] as const).map((option) => {
        const Icon = ICONS[option];
        const active = option === 'dark' ? dark : !dark;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={active}
            aria-label={t(option)}
            title={t(option)}
            onClick={() => choose(option)}
            className={cn(
              'grid size-11 place-items-center rounded-full transition-[background-color,color,box-shadow] duration-150 [&_svg]:size-[18px]',
              'focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
              active
                ? 'bg-brand text-brand-foreground shadow-[0_0_0_1px_var(--glow),0_6px_16px_-8px_var(--glow)]'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
