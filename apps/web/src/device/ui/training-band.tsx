'use client';

import { useTranslations } from 'next-intl';
import { usePos } from '../store';

/**
 * A practice device (RF-F22): an orange band on every screen, so nobody takes a practice order
 * or receipt for a real one.
 */
export function TrainingBand() {
  const training = usePos((state) => state.bootstrap?.organization.isTraining ?? false);
  const t = useTranslations('pos.training');
  if (!training) return null;
  return (
    <p
      role="status"
      data-testid="training-band"
      className="bg-orange-500 px-3 py-1 text-center text-sm font-bold tracking-wide text-white uppercase"
    >
      {t('band')}
    </p>
  );
}
