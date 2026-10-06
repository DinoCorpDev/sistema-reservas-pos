import { uuidv7 } from 'uuidv7';

/**
 * Core identifiers (PA-10): UUID v7 generated on the device, so records can be created
 * offline and sorted by time. In MySQL they are stored as BINARY(16).
 */

declare const uuidBrand: unique symbol;
export type Uuid = string & { readonly [uuidBrand]: true };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function newId(): Uuid {
  return uuidv7() as Uuid;
}

export function isUuid(value: unknown): value is Uuid {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function asUuid(value: string): Uuid {
  const normalized = value.toLowerCase();
  if (!isUuid(normalized)) {
    throw new TypeError(`Invalid UUID: "${value}"`);
  }
  return normalized;
}

/** Unix milliseconds encoded in a UUID v7 (useful for debugging and sorting). */
export function uuidV7Timestamp(id: Uuid): number {
  const hex = id.replaceAll('-', '').slice(0, 12);
  return Number.parseInt(hex, 16);
}
