import type { Permission } from '@pos/core';
import { type Database, randomToken, schema as s, sha256Hex } from '@pos/db';
import { and, eq, isNull } from 'drizzle-orm';
import type { Actor } from '../actor';
import { ApiError } from '../errors';

/**
 * API keys per organization (RF-F14): `pos_live_<random>`. Only the SHA-256 is stored. Scopes are
 * coarse and map to permissions; Phase 5 adds the order and reservation scopes Zitas needs.
 */
export const API_KEY_SCOPES = {
  'catalog:read': [] as Permission[],
  'catalog:write': ['catalog.manage', 'catalog.price_change', 'catalog.sold_out'] as Permission[],
  'customers:write': ['customer.manage'] as Permission[],
  'reservations:write': ['reservation.manage'] as Permission[],
} as const;
export type ApiKeyScope = keyof typeof API_KEY_SCOPES;
export const API_KEY_SCOPE_NAMES = Object.keys(API_KEY_SCOPES) as ApiKeyScope[];

const PREFIX = 'pos_live_';

export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const key = `${PREFIX}${randomToken(32)}`;
  return { key, prefix: key.slice(0, PREFIX.length + 8), hash: sha256Hex(key) };
}

export function looksLikeApiKey(token: string): boolean {
  return token.startsWith(PREFIX);
}

export async function resolveApiKeyActor(
  db: Database,
  key: string,
  locationId: string | null,
): Promise<Actor> {
  const [row] = await db
    .select()
    .from(s.apiKeys)
    .where(and(eq(s.apiKeys.keyHash, sha256Hex(key)), isNull(s.apiKeys.revokedAt), isNull(s.apiKeys.deletedAt)));
  if (!row || (row.expiresAt && row.expiresAt <= new Date())) {
    throw new ApiError('UNAUTHENTICATED', 'Invalid or revoked API key');
  }
  if (locationId) {
    const [location] = await db
      .select({ id: s.locations.id })
      .from(s.locations)
      .where(and(eq(s.locations.id, locationId), eq(s.locations.organizationId, row.organizationId)));
    if (!location) throw new ApiError('NOT_FOUND', 'Location not found');
  }
  await db.update(s.apiKeys).set({ lastUsedAt: new Date() }).where(eq(s.apiKeys.id, row.id));

  const scopes = new Set(row.scopes);
  const permissions = new Set<Permission>();
  for (const scope of scopes) {
    for (const permission of API_KEY_SCOPES[scope as ApiKeyScope] ?? []) permissions.add(permission);
  }
  return {
    kind: 'api_key',
    organizationId: row.organizationId,
    locationId,
    userId: null,
    permissions,
    scopes,
    requestId: `api_key:${row.keyPrefix}`,
  };
}
