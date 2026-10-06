import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/server/db';

export const dynamic = 'force-dynamic';

/**
 * Cloud health (RNF-16): responds 200 if the API and the database are up, 503 if the database
 * does not respond. Consumed by the Phase 6 monitoring.
 */
export async function GET() {
  const startedAt = Date.now();
  let database: 'ok' | 'down' = 'ok';
  try {
    await getDb().execute(sql`SELECT 1`);
  } catch {
    database = 'down';
  }
  const body = {
    status: database === 'ok' ? 'ok' : 'degraded',
    service: 'web',
    checks: { database },
    latencyMs: Date.now() - startedAt,
    time: new Date().toISOString(),
  };
  return NextResponse.json(body, {
    status: database === 'ok' ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}
