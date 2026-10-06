import { is } from 'drizzle-orm';
import { getTableConfig, MySqlTable } from 'drizzle-orm/mysql-core';
import { describe, expect, it } from 'vitest';
import * as schema from './schema';
import { TABLE_GROUPS } from './table-groups';

type Group = keyof typeof TABLE_GROUPS;

const allTables = (Object.values(schema) as unknown[]).filter((value): value is MySqlTable =>
  is(value, MySqlTable),
);
const configOf = (table: MySqlTable) => getTableConfig(table);
const column = (table: MySqlTable, name: string) =>
  configOf(table).columns.find((c) => c.name === name);
const tablesIn = (...groups: Group[]) =>
  groups.flatMap((group) => TABLE_GROUPS[group] as readonly MySqlTable[]);
const nameOf = (table: MySqlTable) => configOf(table).name;

describe('schema invariants', () => {
  it('classifies every table in exactly one group', () => {
    const grouped = tablesIn(...(Object.keys(TABLE_GROUPS) as Group[]));
    expect(new Set(grouped).size).toBe(grouped.length);
    expect(grouped.map(nameOf).sort()).toEqual(allTables.map(nameOf).sort());
  });

  it.each(allTables.map((t) => [nameOf(t), t] as const))(
    '%s has a BINARY(16) UUID primary key named id',
    (_name, table) => {
      const id = column(table, 'id');
      expect(id?.primary).toBe(true);
      expect(id?.getSQLType()).toBe('binary(16)');
    },
  );

  const outsideTenants = new Set(tablesIn('root', 'platform'));
  it.each(
    allTables.filter((t) => !outsideTenants.has(t)).map((t) => [nameOf(t), t] as const),
  )('%s is scoped to an organization (PA-09, RNF-12)', (_name, table) => {
    const org = column(table, 'organization_id');
    expect(org?.notNull).toBe(true);
    expect(org?.getSQLType()).toBe('binary(16)');
  });

  const locationScoped = [
    ...tablesIn('config').filter((t) => nameOf(t) !== 'locations'),
    ...tablesIn('operational'),
    ...tablesIn('appendOnly').filter((t) => nameOf(t) !== 'audit_events'),
    ...tablesIn('infrastructure').filter((t) => nameOf(t) !== 'outbox_events'),
  ];
  it.each(locationScoped.map((t) => [nameOf(t), t] as const))(
    '%s is scoped to a location',
    (_name, table) => {
      expect(column(table, 'location_id')?.notNull).toBe(true);
    },
  );

  it('never stores money or quantities as decimal or float (PA-08)', () => {
    for (const table of allTables) {
      for (const col of configOf(table).columns) {
        expect(col.getSQLType(), `${nameOf(table)}.${col.name}`).not.toMatch(
          /decimal|numeric|float|double|real/i,
        );
      }
    }
  });

  it('stores every *_rappen column as an integer', () => {
    const rappenColumns = allTables.flatMap((table) =>
      configOf(table)
        .columns.filter((c) => c.name.endsWith('_rappen'))
        .map((c) => [`${nameOf(table)}.${c.name}`, c.getSQLType()] as const),
    );
    expect(rappenColumns.length).toBeGreaterThan(30);
    for (const [name, type] of rappenColumns) {
      expect(type, name).toMatch(/^(int|bigint)$/);
    }
  });

  it.each(
    tablesIn('root', 'platform', 'config', 'master', 'operational').map(
      (t) => [nameOf(t), t] as const,
    ),
  )(
    '%s supports soft delete and server timestamps (nothing is deleted)',
    (_name, table) => {
      expect(column(table, 'deleted_at')).toBeDefined();
      expect(column(table, 'created_at')?.notNull).toBe(true);
      expect(column(table, 'updated_at')?.notNull).toBe(true);
    },
  );

  it.each(tablesIn('operational').map((t) => [nameOf(t), t] as const))(
    '%s is sync-ready: version, device time and no hard foreign keys',
    (_name, table) => {
      expect(column(table, 'version')?.notNull).toBe(true);
      expect(column(table, 'device_updated_at')).toBeDefined();
      expect(configOf(table).foreignKeys).toHaveLength(0);
    },
  );

  it.each(tablesIn('config', 'master').map((t) => [nameOf(t), t] as const))(
    '%s enforces referential integrity with foreign keys',
    (_name, table) => {
      expect(configOf(table).foreignKeys.length).toBeGreaterThan(0);
    },
  );

  it.each(tablesIn('appendOnly').map((t) => [nameOf(t), t] as const))(
    '%s is append-only: no updated_at nor deleted_at (RN-10)',
    (_name, table) => {
      expect(column(table, 'updated_at')).toBeUndefined();
      expect(column(table, 'deleted_at')).toBeUndefined();
    },
  );

  it('freezes price, tax rate and tax amount on each order item (RN-04)', () => {
    for (const name of [
      'unit_price_rappen',
      'line_total_rappen',
      'tax_rate_code',
      'tax_rate_bp',
      'tax_rappen',
      'name_snapshot',
    ]) {
      expect(column(schema.orderItems, name)?.notNull, name).toBe(true);
    }
  });

  it('guards payments and sync operations with idempotency keys (PA-10)', () => {
    for (const table of [schema.payments, schema.refunds, schema.syncOperations]) {
      const indexes = configOf(table).indexes.filter((i) => i.config.unique);
      const keyed = indexes.some((i) =>
        i.config.columns.some((c) => 'name' in c && c.name === 'idempotency_key'),
      );
      expect(keyed, nameOf(table)).toBe(true);
    }
  });
});
