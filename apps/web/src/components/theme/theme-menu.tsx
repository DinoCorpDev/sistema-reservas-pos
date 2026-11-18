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
import { applyTheme, saveTheme, storedTheme, type Theme, THEMES } from './theme';

const ICONS = { light: SunIcon, dark: MoonIcon, system: MonitorIcon } as const;

/** Light, dark or automatic (the device's setting), for this device (DEC-049). */
export function ThemeMenu({ className }: { className?: string }) {
  const t = useTranslations('pos.theme');
  const [theme, setTheme] = useState<Theme>('system');

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
