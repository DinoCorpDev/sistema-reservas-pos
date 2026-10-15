import type { createApiKeySchema } from '@pos/core';
import { inOrg, notDeleted, ownedByOrg, runCommand, schema as s } from '@pos/db';
import { desc, eq } from 'drizzle-orm';
import type { z } from 'zod';
import { type Actor, assertPermission } from '../../actor';
import { API_KEY_SCOPE_NAMES, generateApiKey } from '../../auth/api-keys';
import { ApiError, notFound } from '../../errors';
import { iso, type ServiceDeps } from '../shared';
import { assertGrowth } from '../platform/plans';

// ── API keys (RF-F14) ───────────────────────────────────────────────────────

type ApiKeyRow = typeof s.apiKeys.$inferSelect;

const toApiKeyDto = (row: ApiKeyRow) => ({
  id: row.id,
  name: row.name,
  keyPrefix: row.keyPrefix,
  scopes: row.scopes,
  createdByUserId: row.createdByUserId,
  createdAt: row.createdAt.toISOString(),
  lastUsedAt: iso(row.lastUsedAt),
  expiresAt: iso(row.expiresAt),
  revokedAt: iso(row.revokedAt),
});
export type ApiKeyDto = ReturnType<typeof toApiKeyDto>;

async function loadApiKey(deps: ServiceDeps, actor: Actor, id: string) {
  const [row] = await deps.db
    .select()
    .from(s.apiKeys)
    .where(inOrg(s.apiKeys, actor, eq(s.apiKeys.id, id), notDeleted(s.apiKeys)));
  if (!row) throw notFound('API key');
  return row;
}

/** The organization's keys, revoked ones included; never the key itself. */
export async function listApiKeys(deps: ServiceDeps, actor: Actor): Promise<ApiKeyDto[]> {
  assertPermission(actor, 'user.manage');
  const rows = await deps.db
    .select()
    .from(s.apiKeys)
    .where(inOrg(s.apiKeys, actor, notDeleted(s.apiKeys)))
    .orderBy(desc(s.apiKeys.createdAt));
  return rows.map(toApiKeyDto);
}

/** Creates a key; the full key is returned ONCE, only its SHA-256 is stored. */
export async function createApiKey(
  deps: ServiceDeps,
  actor: Actor,
  input: z.output<typeof createApiKeySchema>,
): Promise<ApiKeyDto & { key: string }> {
  assertPermission(actor, 'user.manage');
  // The API is a module of the plan (DEC-045).
  await assertGrowth(deps.db, actor.organizationId, { feature: 'api' });
  const known = new Set<string>(API_KEY_SCOPE_NAMES);
  const unknown = input.scopes.filter((scope) => !known.has(scope));
  if (unknown.length > 0) {
    throw new ApiError('VALIDATION_FAILED', `Unknown scopes: ${unknown.join(', ')}`, {
      path: ['scopes'],
      allowed: API_KEY_SCOPE_NAMES,
    });
  }
  const scopes = API_KEY_SCOPE_NAMES.filter((scope) => input.scopes.includes(scope));
  const { key, prefix, hash } = generateApiKey();
  const id = await runCommand(deps.db, actor, async (tx, recorder) => {
    const [row] = await tx
      .insert(s.apiKeys)
      .values(
        ownedByOrg(actor, {
          name: input.name,
          keyPrefix: prefix,
          keyHash: hash,
          scopes,
          createdByUserId: actor.userId ?? null,
        }),
      )
      .$returningId();
    recorder.audit({
      action: 'api_key.created',
      entityType: 'api_key',
      entityId: row!.id,
      locationId: null,
      after: { name: input.name, keyPrefix: prefix, scopes },
    });
    return row!.id;
  });
  return { ...toApiKeyDto(await loadApiKey(deps, actor, id)), key };
}

/** Revokes a key at once (idempotent); the row stays for the audit trail. */
export async function revokeApiKey(deps: ServiceDeps, actor: Actor, id: string): Promise<void> {
  assertPermission(actor, 'user.manage');
  const row = await loadApiKey(deps, actor, id);
  if (row.revokedAt) return;
  await runCommand(deps.db, actor, async (tx, recorder) => {
    await tx
      .update(s.apiKeys)
      .set({ revokedAt: new Date() })
      .where(inOrg(s.apiKeys, actor, eq(s.apiKeys.id, id)));
    recorder.audit({
      action: 'api_key.revoked',
      entityType: 'api_key',
      entityId: id,
      locationId: null,
      before: { name: row.name, keyPrefix: row.keyPrefix },
    });
  });
}
