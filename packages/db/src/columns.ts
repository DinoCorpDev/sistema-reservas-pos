import { newId } from '@pos/core';
import { sql } from 'drizzle-orm';
import { customType, datetime, int } from 'drizzle-orm/mysql-core';

/**
 * Schema column conventions (see docs/ARQUITECTURA.md → "Convenciones de datos").
 *
 * - IDs: UUID v7 generated on the device, stored as BINARY(16), exposed as strings.
 * - Money: integers in rappen, columns with the `_rappen` suffix (int). Never decimal or float.
 * - Times: DATETIME(3) in UTC. Business dates (`business_date`) are DATE in the location's time zone.
 * - Nothing is deleted: `deleted_at` (soft delete) on everything that is not append-only.
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

/** UUID stored as BINARY(16). In TypeScript it is always a canonical lowercase string. */
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

/** UUID v7 primary key; generated here if the device does not send one. */
export const primaryId = () => uuid('id').primaryKey().$defaultFn(newId);

export const organizationId = () => uuid('organization_id').notNull();
export const locationId = () => uuid('location_id').notNull();

/** Amount in rappen (signed integer). */
export const rappen = (name: string) => int(name).notNull().default(0);

export const utcDatetime = (name: string) => datetime(name, { mode: 'date', fsp: 3 });

const now = sql`(CURRENT_TIMESTAMP(3))`;

/** created_at / updated_at (server time) and deleted_at (soft delete). */
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
 * Sync columns of the operational tables (PA-10, RNF-04): optimistic version and device time
 * of the last change. The conflict rules are written in docs/SYNC.md.
 */
export const syncColumns = () => ({
  version: int('version').notNull().default(1),
  deviceUpdatedAt: utcDatetime('device_updated_at'),
});
