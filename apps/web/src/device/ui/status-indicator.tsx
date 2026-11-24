'use client';

import { cn } from '@pos/ui/utils';
import { Cloud, CloudOff, CloudUpload, Router } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePos } from '../store';

/**
 * Connection indicator on every POS screen (RNF-02, RNF-03, docs/SYNC.md §1): the level the
 * terminal works at and, separately, how many of its operations the cloud has not confirmed. On a
 * phone (DEC-036) it shrinks to the icon and the count, with the full text for screen readers.
 */
export function StatusIndicator({ className }: { className?: string }) {
  const t = useTranslations('pos.status');
  const sync = usePos((state) => state.sync);
  const Icon = sync.level === 'cloud' ? Cloud : sync.level === 'hub' ? Router : CloudOff;
  return (
    <div
      className={cn('flex items-center gap-2 text-sm sm:gap-3', className)}
      role="status"
      aria-live="polite"
    >
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium sm:px-3',
          sync.level === 'standalone'
            ? 'bg-amber-100 text-amber-900'
            : 'bg-emerald-100 text-emerald-900',
        )}
        data-testid="sync-level"
        data-level={sync.level}
        title={t(sync.level)}
      >
        <Icon className="size-4" aria-hidden />
        {/* On a tablet the colour and the icon say it; the word comes on wide screens. */}
        <span className="max-xl:sr-only">{t(sync.level)}</span>
      </span>
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-medium tabular-nums',
          // Nothing waiting is the normal case: it is said to screen readers, not shown.
          sync.pending > 0 ? 'bg-amber-100 text-amber-900' : 'sr-only',
        )}
        data-testid="sync-pending"
        data-pending={sync.pending}
        title={t('pending', { count: sync.pending })}
      >
        <CloudUpload className="size-4" aria-hidden />
        <span className="xl:hidden" aria-hidden>
          {sync.pending}
        </span>
        <span className="max-xl:sr-only">{t('pending', { count: sync.pending })}</span>
      </span>
      {sync.rejected > 0 && (
        <span className="text-destructive">{t('rejected', { count: sync.rejected })}</span>
      )}
    </div>
  );
}
