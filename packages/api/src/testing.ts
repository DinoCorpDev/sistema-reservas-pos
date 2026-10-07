import { newId } from '@pos/core';
import {
  applyOrganizationTemplate,
  createDb,
  type Database,
  hashPassword,
  newPinKey,
  pinLookup,
  schema as s,
} from '@pos/db';
import { testDatabaseUrl } from '@pos/db/testing';
import { eq } from 'drizzle-orm';
import type { BackofficeSession } from './auth/resolve-actor';
import { createApiApp } from './http/app';

/**
 * Test harness for API integration tests: the real Hono app against the MySQL test database,
 * with a fake backoffice session selected by the `x-test-session` header.
 */
export function createTestApi() {
  const { db, pool } = createDb(testDatabaseUrl(), { connectionLimit: 4 });
  const sessions = new Map<string, BackofficeSession>();
  const app = createApiApp({
    db,
    resolveSession: async (request) =>
      sessions.get(request.headers.get('x-test-session') ?? '') ?? null,
  });

  /** Headers that sign the request in as this backoffice session. */
  const as = (session: BackofficeSession): Record<string, string> => {
    const key = newId();
    sessions.set(key, session);
    return { 'x-test-session': key };
  };

  const request = (
    method: string,
    path: string,
    init: { headers?: Record<string, string>; body?: unknown } = {},
  ) =>
    app.request(`/api/v1${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...init.headers },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });

  return { app, db, as, request, close: () => pool.end() };
}

export interface DemoContext {
  organizationId: string;
  locationId: string;
  users: Record<'admin' | 'manager' | 'cashier' | 'waiter' | 'waiter2' | 'kitchen', { id: string }>;
}

/** Ids of the seeded "Restaurant Demo Zürich" and its users. */
export async function loadDemo(db: Database): Promise<DemoContext> {
  const [org] = await db
    .select()
    .from(s.organizations)
    .where(eq(s.organizations.slug, 'demo-gastro'));
  if (!org) throw new Error('Demo organization missing: the test database setup did not run');
  const [location] = await db
    .select()
    .from(s.locations)
    .where(eq(s.locations.organizationId, org.id));
  const users = await db.select().from(s.users).where(eq(s.users.organizationId, org.id));
  const byName = (name: string) => {
    const user = users.find((u) => u.displayName === name);
    if (!user) throw new Error(`Demo user ${name} missing`);
    return { id: user.id };
  };
  return {
    organizationId: org.id,
    locationId: location!.id,
    users: {
      admin: byName('Sandra Keller'),
      manager: byName('Marco Brunner'),
      cashier: byName('Lea Meier'),
      waiter: byName('Anna Huber'),
      waiter2: byName('Luca Rossi'),
      kitchen: byName('Jonas Weber'),
    },
  };
}

/** Backoffice session of a demo user at the demo location. */
export const demoSession = (
  demo: DemoContext,
  user: keyof DemoContext['users'],
): BackofficeSession => ({
  kind: 'user',
  userId: demo.users[user].id,
  organizationId: demo.organizationId,
  locationId: demo.locationId,
});

/**
 * A second, independent organization with an admin user, for cross-tenant tests (RNF-12).
 */
export async function createOtherOrganization(db: Database, name = 'Other Gastro') {
  const organizationId = newId();
  const locationId = newId();
  const adminId = newId();
  const pinKey = newPinKey();
  const passwordHash = await hashPassword('other-password-123');
  await db.transaction(async (tx) => {
    await tx.insert(s.organizations).values({
      id: organizationId,
      name,
      slug: `other-${organizationId.slice(-12)}`,
      pinKey,
    });
    await tx.insert(s.locations).values({
      id: locationId,
      organizationId,
      name,
      legalName: name,
      street: 'Bahnhofplatz 1',
      postalCode: '3011',
      city: 'Bern',
      languages: ['de', 'fr'],
      settings: {} as never,
    });
    const { roleIds } = await applyOrganizationTemplate(tx, organizationId, 'de');
    await tx.insert(s.users).values({
      id: adminId,
      organizationId,
      displayName: `${name} Admin`,
      email: `admin-${organizationId.slice(-12)}@other.test`,
      passwordHash,
      pinHash: await hashPassword('9999'),
      pinLookup: pinLookup(pinKey, '9999'),
    });
    await tx.insert(s.userLocations).values({ organizationId, userId: adminId, locationId });
    await tx.insert(s.userRoles).values({ organizationId, userId: adminId, roleId: roleIds.admin });
  });
  const session: BackofficeSession = { kind: 'user', userId: adminId, organizationId, locationId };
  return { organizationId, locationId, adminId, session };
}
