'use client';

import { Button } from '@pos/ui/button';
import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ComponentProps } from 'react';
import { type ListView, usePosUi } from '../../ui-store';

const placeKey = (origin: ListView) => (origin.name === 'counter' ? origin.channel : origin.name);

/**
 * Back to the list the order was opened from: tables, orders, bar or take-away. `short` shows only
 * the place, and only on wider screens.
 */
export function BackButton({
  short = false,
  ...props
}: Omit<ComponentProps<typeof Button>, 'onClick' | 'children'> & { short?: boolean }) {
  const t = useTranslations('posOrder.order');
  const ts = useTranslations('pos.shell');
  const origin = usePosUi((state) => state.origin);
  const goBack = usePosUi((state) => state.goBack);
  const place = ts(placeKey(origin));
  const label = t('backTo', { place });
  return (
    <Button {...props} aria-label={label} onClick={goBack}>
      <ArrowLeft />
      {short ? <span className="hidden sm:inline">{place}</span> : label}
    </Button>
  );
}
