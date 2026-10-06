'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@pos/ui/select';
import { useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { LOCALE_NAMES, UI_LOCALES } from '@/i18n/locales';

/** Language switch (RF-A08); `onChange` persists it (cookie before sign-in, user profile after). */
export function LanguagePicker({
  onChange,
  label,
}: {
  onChange: (language: string) => Promise<unknown>;
  label: string;
}) {
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Select
      value={locale}
      disabled={pending}
      onValueChange={(value) =>
        startTransition(async () => {
          await onChange(value);
          router.refresh();
        })
      }
    >
      <SelectTrigger aria-label={label} className="w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {UI_LOCALES.map((code) => (
          <SelectItem key={code} value={code}>
            {LOCALE_NAMES[code]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
