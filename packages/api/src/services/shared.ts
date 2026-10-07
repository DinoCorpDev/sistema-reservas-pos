import type { Database } from '@pos/db';
import type { Actor } from '../actor';

/** Dependencies every use case receives. */
export interface ServiceDeps {
  db: Database;
}

export type ServiceFn<I, O> = (deps: ServiceDeps, actor: Actor, input: I) => Promise<O>;

export const iso = (value: Date | null | undefined): string | null =>
  value ? value.toISOString() : null;

/** Keeps only the keys whose value changed, for compact audit records. */
export function changedFields<T extends Record<string, unknown>>(
  before: T,
  patch: Partial<T>,
): { before: Partial<T>; after: Partial<T> } {
  const b: Partial<T> = {};
  const a: Partial<T> = {};
  for (const key of Object.keys(patch) as (keyof T)[]) {
    if (patch[key] === undefined) continue;
    if (JSON.stringify(before[key]) !== JSON.stringify(patch[key])) {
      b[key] = before[key];
      a[key] = patch[key];
    }
  }
  return { before: b, after: a };
}

/** Drops `undefined` values so a PATCH only touches the fields that were sent. */
export function definedOnly<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
