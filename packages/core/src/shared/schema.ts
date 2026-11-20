import { z } from 'zod';

type WithoutDefaults<T extends z.ZodRawShape> = {
  [K in keyof T]: T[K] extends z.ZodDefault<infer Inner> ? Inner : T[K];
};

/**
 * PATCH schema of a create schema: every field optional and WITHOUT its default. Zod 4 keeps
 * inner defaults under `.partial()`, which would silently reset omitted fields on update.
 */
export function patchOf<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  const shape = Object.fromEntries(
    Object.entries(schema.shape).map(([key, field]) => [
      key,
      field instanceof z.ZodDefault ? field.unwrap() : field,
    ]),
  ) as WithoutDefaults<T>;
  return z.object(shape).partial();
}
