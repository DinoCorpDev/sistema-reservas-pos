'use client';

import { Avatar } from '@pos/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@pos/ui/dropdown-menu';
import { toast } from '@pos/ui/toaster';
import { cn } from '@pos/ui/utils';
import {
  ChevronDown,
  CircleHelp,
  Globe,
  LogOut,
  MonitorIcon,
  MoonIcon,
  SunIcon,
  TimerIcon,
} from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { type HelpRole, helpLanguageOf } from '@/help/manuals';
import {
  applyTheme,
  DEFAULT_THEME,
  saveTheme,
  storedTheme,
  type Theme,
  THEMES,
} from '@/components/theme/theme';
import { asDeviceLanguage, DEVICE_LANGUAGES } from '../i18n';
import { chooseLanguage } from '../language';
import { usePos } from '../store';
import { clockIn } from '../time';
import { ClockOutDialog, useOpenEntry } from './clock';
import { NATIVE_NAMES } from './language-menu';

const THEME_ICONS = { light: SunIcon, dark: MoonIcon, system: MonitorIcon } as const;

/**
 * The person on the terminal (DEC-053, DEC-054): the avatar opens their own things — the shift,
 * the theme, the language and the manual — so the bar keeps only what the service needs. A green
 * dot on the avatar means clocked in.
 */
export function PersonMenu({
  helpRole,
  nameTestId,
  className,
}: {
  helpRole: HelpRole;
  /** `pos-user` on the POS, `kds-user` on the KDS (the tests read the name there). */
  nameTestId: string;
  className?: string;
}) {
  const t = useTranslations('pos.person');
  const tc = useTranslations('pos.clock');
  const tt = useTranslations('pos.theme');
  const th = useTranslations('pos.help');
  const format = useFormatter();
  const user = usePos((state) => state.user);
  const training = usePos((state) => state.bootstrap?.organization.isTraining ?? false);
  const entry = useOpenEntry();
  const language = asDeviceLanguage(useLocale());
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);
  const [confirmEnd, setConfirmEnd] = useState(false);

  useEffect(() => setTheme(storedTheme()), []);
  useEffect(() => {
    if (theme !== 'system') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const follow = () => applyTheme('system');
    query.addEventListener('change', follow);
    return () => query.removeEventListener('change', follow);
  }, [theme]);

  if (!user) return null;
  const since = entry?.clockInAt
    ? format.dateTime(new Date(entry.clockInAt), { timeStyle: 'short' })
    : null;

  const start = async () => {
    await clockIn();
    toast.success(tc('started', { time: format.dateTime(new Date(), { timeStyle: 'short' }) }));
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-testid="person-menu"
            aria-label={t('open', { name: user.displayName })}
            className={cn(
              'flex min-h-11 items-center gap-2 rounded-full border bg-card py-1 pr-2.5 pl-1 text-sm font-medium transition-colors hover:bg-accent',
              'focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
              'dark:border-white/15 dark:bg-white/5 dark:text-chrome-foreground dark:hover:bg-white/10',
              className,
            )}
          >
            <span className="relative">
              <Avatar name={user.displayName} colorKey={user.id} size="sm" />
              {since ? (
                <span
                  data-testid="clocked-in-dot"
                  aria-hidden
                  className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-card bg-success dark:border-chrome"
                />
              ) : null}
            </span>
            <span className="max-w-32 truncate max-xl:sr-only" data-testid={nameTestId}>
              {user.displayName}
            </span>
            <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <div className="flex items-center gap-3 px-3 py-2">
            <Avatar name={user.displayName} colorKey={user.id} />
            <div className="min-w-0">
              <p className="truncate font-semibold">{user.displayName}</p>
              <p
                className="text-xs text-muted-foreground"
                data-testid={since ? 'clocked-in' : undefined}
              >
                {since ? tc('since', { time: since }) : t('notClockedIn')}
              </p>
            </div>
          </div>
          {training ? null : (
            <>
              <DropdownMenuSeparator />
              {since ? (
                <DropdownMenuItem onSelect={() => setConfirmEnd(true)}>
                  <LogOut /> {tc('end')}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => void start()}>
                  <TimerIcon /> {tc('start')}
                </DropdownMenuItem>
              )}
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger data-testid="person-language">
              <Globe /> {t('language')}
              <span className="ml-auto text-xs text-muted-foreground">
                {NATIVE_NAMES[language]}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={language}
                onValueChange={(value) => void chooseLanguage(asDeviceLanguage(value))}
              >
                {DEVICE_LANGUAGES.map((option) => (
                  <DropdownMenuRadioItem key={option} value={option} lang={option}>
                    {NATIVE_NAMES[option]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger data-testid="person-theme">
              {(() => {
                const Icon = THEME_ICONS[theme];
                return <Icon />;
              })()}
              {tt('label')}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={theme}
                onValueChange={(value) => {
                  const next = value as Theme;
                  setTheme(next);
                  saveTheme(next);
                }}
              >
                {THEMES.map((option) => {
                  const Icon = THEME_ICONS[option];
                  return (
                    <DropdownMenuRadioItem key={option} value={option}>
                      <Icon /> {tt(option)}
                    </DropdownMenuRadioItem>
                  );
                })}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem asChild>
            <a
              href={`/help/${helpLanguageOf(asDeviceLanguage(user.uiLanguage))}/${helpRole}`}
              target="_blank"
              rel="noopener"
              data-testid="help-link"
            >
              <CircleHelp /> {th('open')}
            </a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ClockOutDialog open={confirmEnd} onOpenChange={setConfirmEnd} />
    </>
  );
}
