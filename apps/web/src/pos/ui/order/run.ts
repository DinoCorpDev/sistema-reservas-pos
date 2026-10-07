'use client';

import { LineError } from '@pos/core';
import { toast } from '@pos/ui/toaster';
import { useTranslations } from 'next-intl';
import { useCallback } from 'react';

/**
 * POS actions of these screens run one after another: each one reads the state the previous one
 * left (e.g. two quick taps on the same product raise one line to 2 instead of adding two lines).
 */
let tail: Promise<unknown> = Promise.resolve();

export function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = tail.then(task, task);
  tail = result.catch(() => undefined);
  return result;
}

export type RunResult<T> = { ok: true; value: T } | { ok: false };

/** Runs an action in the queue and turns a failure into a message for the person (never a crash). */
export function useRunner() {
  const t = useTranslations('posOrder.errors');
  return useCallback(
    async <T>(task: () => Promise<T>): Promise<RunResult<T>> => {
      try {
        return { ok: true, value: await enqueue(task) };
      } catch (error) {
        console.error(error);
        toast.error(error instanceof LineError ? t(`line.${error.code}`) : t('generic'));
        return { ok: false };
      }
    },
    [t],
  );
}
