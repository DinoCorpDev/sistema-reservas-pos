import { OPERATION_SCHEMA_VERSION, PERMISSIONS } from '@pos/core';
import { type Database, schema as s, sha256Hex } from '@pos/db';
import { sql } from 'drizzle-orm';
import { getTableConfig, type MySqlTable } from 'drizzle-orm/mysql-core';

/**
 * Version of the configuration a terminal works with (docs/SYNC.md §6.4, §12, RF-F23): a hash of
 * the last change and the row count of every configuration table of the location and its
 * organization. Any backoffice change (product, price, table, user, PIN, tax rule…) changes it,
 * and terminals fetch a new bootstrap. Memoized for a few seconds per location.
 */

const ORGANIZATION_TABLES: MySqlTable[] = [
  s.organizations,
  s.users,
  s.userLocations,
  s.roles,
  s.userRoles,
  s.rolePermissions,
  s.taxCategories,
  s.taxRates,
  s.taxRules,
  s.categories,
  s.products,
  s.productVariants,
  s.modifierGroups,
  s.modifiers,
  s.productModifierGroups,
  s.productAllergens,
  s.modifierAllergens,
  s.productOrigins,
  s.translations,
  s.availabilityRules,
  s.channelPrices,
];

const LOCATION_TABLES: MySqlTable[] = [
  s.areas,
  s.diningTables,
  s.terminals,
  s.kitchenStations,
  s.printers,
  s.productLocationSettings,
  s.productStationRoutes,
];

const MEMO_MS = 10_000;
const memo = new Map<string, { value: string; expires: number }>();

export async function configVersion(
  db: Database,
  scope: { organizationId: string; locationId: string },
  options: { fresh?: boolean } = {},
): Promise<string> {
  const key = `${scope.organizationId}:${scope.locationId}`;
  const cached = memo.get(key);
  if (!options.fresh && cached && cached.expires > Date.now()) return cached.value;

  const org = sql`unhex(replace(${scope.organizationId}, '-', ''))`;
  const loc = sql`unhex(replace(${scope.locationId}, '-', ''))`;
  const parts = [
    sql`select 'locations' t, max(updated_at) m, count(*) c from ${s.locations} where id = ${loc}`,
    ...ORGANIZATION_TABLES.map((table) =>
      table === s.organizations
        ? sql`select 'organizations', max(updated_at), count(*) from ${table} where id = ${org}`
        : sql`select ${sql.raw(`'${tableName(table)}'`)}, max(updated_at), count(*) from ${table} where organization_id = ${org}`,
    ),
    ...LOCATION_TABLES.map(
      (table) =>
        sql`select ${sql.raw(`'${tableName(table)}'`)}, max(updated_at), count(*) from ${table} where location_id = ${loc}`,
    ),
  ];
  const query = sql.join(parts, sql` union all `);
  const [rows] = (await db.execute(query)) as unknown as [
    { t: string; m: Date | null; c: number }[],
  ];
  // What the code knows counts too: a release that adds a permission or an operation version
  // must make every terminal fetch its credentials and bootstrap again, even if no row changed.
  const fingerprint = [
    `code:${PERMISSIONS.join(',')}:${OPERATION_SCHEMA_VERSION}`,
    ...rows.map((row) => `${row.t}:${row.m ? new Date(row.m).getTime() : 0}:${row.c}`),
  ].join('|');
  const value = sha256Hex(fingerprint).slice(0, 16);
  memo.set(key, { value, expires: Date.now() + MEMO_MS });
  return value;
}

/** Forgets the memoized version (tests, or right after a known change). */
export function forgetConfigVersion(scope?: { organizationId: string; locationId: string }): void {
  if (scope) memo.delete(`${scope.organizationId}:${scope.locationId}`);
  else memo.clear();
}

const tableName = (table: MySqlTable) => getTableConfig(table).name;
