import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/server/db';

export const dynamic = 'force-dynamic';

/**
 * Salud de la nube (RNF-16): responde 200 si la API y la base están arriba, 503 si la base no
 * responde. Lo consume el monitoreo de la Fase 6.
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
