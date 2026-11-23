'use client';

import { Button } from '@pos/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@pos/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@pos/ui/dropdown-menu';
import { Avatar } from '@pos/ui/avatar';
import {
  ChevronDownIcon,
  LifeBuoyIcon,
  LogOutIcon,
  MapPinIcon,
  MenuIcon,
  UserIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { leaveOrganization, logout, setUiLanguage, switchLocation } from '@/app/backoffice/actions';
import { LanguagePicker } from '@/components/language-picker';
import { BackofficeNav } from './nav';
import { ThemeToggle } from '@/components/theme/theme-menu';
import { helpLanguageOf } from '@/help/manuals';

export function TopBar({
  locations,
  locationId,
  userName,
  permissions,
  isSupport,
}: {
  locations: { id: string; name: string }[];
  locationId: string | null;
  userName: string;
  permissions: string[];
  isSupport: boolean;
}) {
  const t = useTranslations('nav');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [menuOpen, setMenuOpen] = useState(false);
  const current = locations.find((l) => l.id === locationId);

  // A printed report (or one saved as PDF) carries the page only (RF-F03).
  return (
    <header className="sticky top-0 z-40 flex min-h-16 flex-wrap items-center gap-3 border-b bg-background/80 px-4 backdrop-blur-md sm:px-6 print:hidden">
      <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label={t('menu')}>
            <MenuIcon />
          </Button>
        </DialogTrigger>
        <DialogContent className="top-0 left-0 h-dvh max-h-dvh translate-x-0 translate-y-0 rounded-none sm:max-w-xs">
          <DialogTitle>{t('menu')}</DialogTitle>
          <BackofficeNav permissions={permissions} onNavigate={() => setMenuOpen(false)} />
        </DialogContent>
      </Dialog>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            disabled={pending || locations.length < 2}
            aria-label={t('location_switch')}
            className="rounded-full pr-3 pl-2 disabled:opacity-100"
          >
            <span className="grid size-7 place-items-center rounded-full bg-brand-soft text-brand-strong [&_svg]:size-4">
              <MapPinIcon />
            </span>
            <span className="max-w-48 truncate text-sm">{current?.name ?? '—'}</span>
            {locations.length > 1 ? <ChevronDownIcon className="text-muted-foreground" /> : null}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>{t('location_switch')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={locationId ?? ''}
            onValueChange={(id) =>
              startTransition(async () => {
                await switchLocation(id);
                router.refresh();
              })
            }
          >
            {locations.map((location) => (
              <DropdownMenuRadioItem key={location.id} value={location.id}>
                {location.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="ml-auto flex items-center gap-2">
        <Button variant="ghost" size="icon" asChild aria-label={t('help')}>
          <a href={`/help/${helpLanguageOf(locale)}/owner`} target="_blank" rel="noopener">
            <LifeBuoyIcon />
          </a>
        </Button>
        <ThemeToggle />
        <LanguagePicker onChange={setUiLanguage} label={t('language')} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" aria-label={t('account')} className="gap-2.5 px-2">
              <Avatar name={userName || '?'} size="sm" />
              <span className="hidden max-w-40 truncate text-sm sm:inline">{userName}</span>
              <ChevronDownIcon className="hidden text-muted-foreground sm:block" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => router.push('/backoffice/account')}>
              <UserIcon /> {t('account')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {isSupport ? (
              <DropdownMenuItem
                onSelect={() =>
                  startTransition(async () => {
                    await leaveOrganization();
                    router.push('/support');
                  })
                }
              >
                <LogOutIcon /> {t('support_leave')}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onSelect={() => startTransition(() => logout())}>
              <LogOutIcon /> {t('logout')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
