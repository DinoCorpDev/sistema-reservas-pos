import type { RowDataPacket } from 'mysql2';
import { afterAll, describe, expect, it } from 'vitest';
import { createPool } from './client';
import { testDatabaseUrl } from './testing';

const pool = createPool(testDatabaseUrl(), { connectionLimit: 1, staleAfterMs: 0 });
const admin = createPool(testDatabaseUrl(), { connectionLimit: 1 });

afterAll(async () => {
  await pool.end();
  await admin.end();
});

const connectionId = async () => {
  const [rows] = await pool.query<({ id: number } & RowDataPacket)[]>(
    'SELECT CONNECTION_ID() AS id',
  );
  return rows[0]!.id;
};

describe('pool (DEC-052)', () => {
  it('hands out a working connection after the server closed an idle one', async () => {
    const first = await connectionId();
    await admin.query(`KILL CONNECTION ${first}`);
    // Every borrow pings here (staleAfterMs 0): a closed connection is replaced, never lent.
    const second = await connectionId();
    expect(second).not.toBe(first);
  });
});
