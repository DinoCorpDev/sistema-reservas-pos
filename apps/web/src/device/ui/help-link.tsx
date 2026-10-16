'use client';

import { Button } from '@pos/ui/button';
import { CircleHelp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type HelpRole, helpLanguageOf } from '@/help/manuals';
import { asDeviceLanguage } from '../i18n';
import { usePos } from '../store';

/**
 * The manual of this screen's role (RNF-21), in a new tab so the POS or KDS keeps its place. The
 * service worker precaches the manuals: they open without internet.
 */
export function HelpLink({ role }: { role: HelpRole }) {
  const t = useTranslations('pos.help');
  const language = usePos((state) => asDeviceLanguage(state.user?.uiLanguage));
  return (
    <Button asChild variant="outline" size="icon">
      <a
        href={`/help/${helpLanguageOf(language)}/${role}`}
        target="_blank"
        rel="noopener"
        aria-label={t('open')}
        title={t('open')}
        data-testid="help-link"
      >
        <CircleHelp />
      </a>
    </Button>
  );
}
