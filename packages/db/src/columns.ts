import { newId } from '@pos/core';
import { sql } from 'drizzle-orm';
import { customType, datetime, int } from 'drizzle-orm/mysql-core';

/**
 * Convenciones de columnas del esquema (ver docs/ARQUITECTURA.md → "Convenciones de datos").
 *
 * - IDs: UUID v7 generados en el dispositivo, guardados como BINARY(16), expuestos como string.
 * - Dinero: enteros en rappen, columnas con sufijo `_rappen` (int). Nunca decimal ni float.
 * - Tiempos: DATETIME(3) en UTC. Las fechas de negocio (`business_date`) son DATE en la zona de la sede.
 * - Nada se borra: `deleted_at` (soft delete) en todo lo que no es append-only.
 */

function uuidToBuffer(value: string): Buffer {
  const hex = value.replaceAll('-', '');
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) {
    throw new TypeError(`Invalid UUID for BINARY(16) column: "${value}"`);
  }
  return Buffer.from(hex, 'hex');
}

function bufferToUuid(value: Buffer | Uint8Array): string {
  const hex = Buffer.from(value).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** UUID guardado como BINARY(16). En TypeScript es siempre un string canónico en minúsculas. */
export const uuid = customType<{ data: string; driverData: Buffer }>({
  dataType() {
    return 'binary(16)';
  },
  toDriver(value) {
    return uuidToBuffer(value);
  },
  fromDriver(value) {
    return bufferToUuid(value);
  },
});

export const uuidCodec = { toBuffer: uuidToBuffer, fromBuffer: bufferToUuid };

/** Clave primaria UUID v7; si el dispositivo no la manda, se genera aquí. */
export const primaryId = () => uuid('id').primaryKey().$defaultFn(newId);

export const organizationId = () => uuid('organization_id').notNull();
export const locationId = () => uuid('location_id').notNull();

/** Monto en rappen (entero con signo). */
export const rappen = (name: string) => int(name).notNull().default(0);

export const utcDatetime = (name: string) => datetime(name, { mode: 'date', fsp: 3 });

const now = sql`(CURRENT_TIMESTAMP(3))`;

/** created_at / updated_at (hora del servidor) y deleted_at (soft delete). */
export const timestamps = () => ({
  createdAt: utcDatetime('created_at')
    .notNull()
    .default(now)
    .$defaultFn(() => new Date()),
  updatedAt: utcDatetime('updated_at')
    .notNull()
    .default(now)
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date()),
  deletedAt: utcDatetime('deleted_at'),
});

/**
 * Columnas de sincronización de las tablas operativas (PA-10, RNF-04): versión optimista y hora
 * del dispositivo del último cambio. Las reglas de conflicto se escriben en docs/SYNC.md.
 */
export const syncColumns = () => ({
  version: int('version').notNull().default(1),
  deviceUpdatedAt: utcDatetime('device_updated_at'),
});
