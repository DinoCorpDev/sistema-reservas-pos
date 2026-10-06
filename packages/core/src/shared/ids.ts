import { uuidv7 } from 'uuidv7';

/**
 * Identificadores del Core (PA-10): UUID v7 generados en el dispositivo, para crear registros
 * sin conexión y ordenarlos por tiempo. En MySQL se guardan como BINARY(16).
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

/** Milisegundos Unix codificados en un UUID v7 (útil para depurar y para ordenar). */
export function uuidV7Timestamp(id: Uuid): number {
  const hex = id.replaceAll('-', '').slice(0, 12);
  return Number.parseInt(hex, 16);
}
