'use client';

import { Button } from '@pos/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@pos/ui/dropdown-menu';
import { Globe } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { asDeviceLanguage, DEVICE_LANGUAGES } from '../i18n';
import { chooseLanguage } from '../language';

/** Each language in its own words, so anyone finds theirs whatever the screen shows now. */
const NATIVE_NAMES: Record<(typeof DEVICE_LANGUAGES)[number], string> = {
  de: 'Deutsch',
  fr: 'Français',
  it: 'Italiano',
  en: 'English',
  es: 'Español',
};

/**
 * The globe next to the person's name (their own language on this device) and on the PIN screen
 * (the language of that screen on this device) (RF-A08).
 */
export function LanguageMenu() {
  const t = useTranslations('pos.language');
  const current = asDeviceLanguage(useLocale());
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label={t('label')} data-testid="language-menu">
          <Globe />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={current}
          onValueChange={(value) => void chooseLanguage(asDeviceLanguage(value))}
        >
          {DEVICE_LANGUAGES.map((language) => (
            <DropdownMenuRadioItem key={language} value={language} lang={language}>
              {NATIVE_NAMES[language]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
