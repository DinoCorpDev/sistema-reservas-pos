import { parseLocationSettings } from '@pos/core';
import { schema as s } from '@pos/db';
import { and, eq, isNull } from 'drizzle-orm';
import { type Actor, requireTerminal } from '../../actor';
import { ApiError, notFound } from '../../errors';
import type { ServiceDeps } from '../shared';

/**
 * `GET /sync/hub-config` (docs/SYNC.md §11.2): what the LAN hub needs to work without internet:
 * the organization, the location (time zone and settings, for numbering) and the terminals of
 * the location with the hash of their device token, so the hub can authenticate them offline.
 * Only for a paired terminal of type `hub`.
 */
export async function getHubConfig(deps: ServiceDeps, actor: Actor) {
  const { locationId } = requireTerminal(actor);
  if (actor.terminalType !== 'hub') {
    throw new ApiError('FORBIDDEN', 'Only the location hub reads its configuration');
  }
  const [organization] = await deps.db
    .select()
    .from(s.organizations)
    .where(eq(s.organizations.id, actor.organizationId));
  const [location] = await deps.db
    .select()
    .from(s.locations)
    .where(
      and(eq(s.locations.id, locationId), eq(s.locations.organizationId, actor.organizationId)),
    );
  if (!organization || !location) throw notFound('Location');
  const terminals = await deps.db
    .select()
    .from(s.terminals)
    .where(and(eq(s.terminals.locationId, locationId), isNull(s.terminals.deletedAt)));
  return {
    organization: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      defaultLanguage: organization.defaultLanguage,
    },
    location: {
      id: location.id,
      name: location.name,
      legalName: location.legalName,
      street: location.street,
      postalCode: location.postalCode,
      city: location.city,
      timezone: location.timezone,
      defaultLanguage: location.defaultLanguage,
      kitchenLanguage: location.kitchenLanguage,
      languages: location.languages,
      settings: parseLocationSettings(location.settings),
    },
    terminals: terminals.map((t) => ({
      id: t.id,
      name: t.name,
      type: t.type,
      orderNumberPrefix: t.orderNumberPrefix,
      deviceTokenHash: t.deviceTokenHash,
      isActive: t.isActive,
    })),
  };
}
export type HubConfigDto = Awaited<ReturnType<typeof getHubConfig>>;
