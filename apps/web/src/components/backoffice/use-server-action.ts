'use client';

import { toast } from '@pos/ui/toaster';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import type { ActionResult } from '@/server/action';

/**
 * Runs a Server Action with a pending state, a success toast and translated errors; field errors
 * from the use case's validation are kept for the form to show next to each field.
 */
export function useServerAction<A extends unknown[], T>(
  action: (...args: A) => Promise<ActionResult<T>>,
  options: { successMessage?: string | false; onSuccess?: (data: T) => void } = {},
) {
  const tErrors = useTranslations('errors');
  const tCommon = useTranslations('common');
  const [pending, startTransition] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const run = (...args: A) =>
    new Promise<ActionResult<T>>((resolve) => {
      startTransition(async () => {
        const result = await action(...args);
        if (result.ok) {
          setFieldErrors({});
          if (options.successMessage !== false)
            toast.success(options.successMessage ?? tCommon('saved'));
          options.onSuccess?.(result.data);
        } else {
          setFieldErrors(result.error.fieldErrors);
          const known = tErrors.has(result.error.code as 'INTERNAL');
          toast.error(known ? tErrors(result.error.code as 'INTERNAL') : result.error.message, {
            description: known ? result.error.message : undefined,
          });
        }
        resolve(result);
      });
    });

  return { run, pending, fieldErrors };
}
