'use client';

import { cn } from '@pos/ui/utils';
import { Cloud, CloudOff, Router } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePos } from '../store';

/**
 * Connection indicator on every POS screen (RNF-02, RNF-03, docs/SYNC.md §1): the level the
 * terminal works at and, separately, how many of its operations the cloud has not confirmed.
 */
export function StatusIndicator({ className }: { className?: string }) {
  const t = useTranslations('pos.status');
  const sync = usePos((state) => state.sync);
  const Icon = sync.level === 'cloud' ? Cloud : sync.level === 'hub' ? Router : CloudOff;
  return (
    <div
      className={cn('flex items-center gap-3 text-sm', className)}
      role="status"
      aria-live="polite"
    >
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-medium',
          sync.level === 'standalone'
            ? 'bg-amber-100 text-amber-900'
            : 'bg-emerald-100 text-emerald-900',
        )}
        data-testid="sync-level"
        data-level={sync.level}
      >
        <Icon className="size-4" aria-hidden />
        {t(sync.level)}
      </span>
      <span
        className={cn(
          'tabular-nums',
          sync.pending > 0 ? 'text-amber-800' : 'text-muted-foreground',
        )}
        data-testid="sync-pending"
        data-pending={sync.pending}
      >
        {t('pending', { count: sync.pending })}
      </span>
      {sync.rejected > 0 && (
        <span className="text-destructive">{t('rejected', { count: sync.rejected })}</span>
      )}
    </div>
  );
}
