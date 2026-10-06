'use client';

import { useState } from 'react';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Form state seeded from server data. While the form is untouched it follows the server data
 * (another tab saved, the page was revalidated); once edited it keeps the edits until it is saved
 * (`reset` with the saved data) or discarded (`reset()`). `source` must be derived from server
 * data only (no generated keys), so equal data gives an equal signature.
 */
export function useDraft<T>(source: T) {
  const signature = JSON.stringify(source);
  const [state, setState] = useState({ seen: signature, base: source, draft: source });
  let current = state;
  if (state.seen !== signature && same(state.draft, state.base)) {
    current = { seen: signature, base: source, draft: source };
    setState(current);
  }

  return {
    draft: current.draft,
    base: current.base,
    dirty: !same(current.draft, current.base),
    setDraft: (update: T | ((draft: T) => T)) =>
      setState((s) => ({
        ...s,
        draft: typeof update === 'function' ? (update as (draft: T) => T)(s.draft) : update,
      })),
    /** Saved (`next` = the data the use case answered with) or discarded (no argument). */
    reset: (next?: T) =>
      setState((s) => {
        const base = next === undefined ? s.base : next;
        return { seen: s.seen, base, draft: base };
      }),
  };
}
