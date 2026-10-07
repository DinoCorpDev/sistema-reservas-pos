import type { HubConfigDto } from '@pos/api';
import { type Database, schema as s } from '@pos/db';
import { and, eq, notInArray } from 'drizzle-orm';
import { type CloudFetch, cloudJson } from './cloud';

/**
 * Copies from the cloud what the hub needs to work offline (docs/SYNC.md §11.2): the
 * organization, the location (time zone and settings for numbering) and the terminals with the
 * hash of their device token, so it authenticates them without internet. Terminals removed in
 * the cloud lose access on the hub too.
 */
export async function syncConfig(
  db: Database,
  cloud: CloudFetch,
): Promise<{ organizationId: string; locationId: string }> {
  const config = await cloudJson<HubConfigDto>(cloud, '/sync/hub-config');
  const { organization: org, location: loc, terminals } = config;
  await db.transaction(async (tx) => {
    await tx
      .insert(s.organizations)
      .values({ id: org.id, name: org.name, slug: org.slug, defaultLanguage: org.defaultLanguage })
      .onDuplicateKeyUpdate({
        set: { name: org.name, slug: org.slug, defaultLanguage: org.defaultLanguage },
      });
    const location = {
      name: loc.name,
      legalName: loc.legalName,
      street: loc.street,
      postalCode: loc.postalCode,
      city: loc.city,
      timezone: loc.timezone,
      defaultLanguage: loc.defaultLanguage,
      kitchenLanguage: loc.kitchenLanguage,
      languages: loc.languages,
      settings: loc.settings,
    };
    await tx
      .insert(s.locations)
      .values({ id: loc.id, organizationId: org.id, ...location })
      .onDuplicateKeyUpdate({ set: location });
    for (const terminal of terminals) {
      const values = {
        name: terminal.name,
        type: terminal.type,
        orderNumberPrefix: terminal.orderNumberPrefix,
        deviceTokenHash: terminal.deviceTokenHash,
        isActive: terminal.isActive,
      };
      await tx
        .insert(s.terminals)
        .values({ id: terminal.id, organizationId: org.id, locationId: loc.id, ...values })
        .onDuplicateKeyUpdate({ set: values });
    }
    // Terminals no longer in the cloud cannot authenticate on the hub anymore.
    const known = terminals.map((t) => t.id);
    await tx
      .update(s.terminals)
      .set({ isActive: false, deviceTokenHash: null })
      .where(
        known.length > 0
          ? and(eq(s.terminals.locationId, loc.id), notInArray(s.terminals.id, known))
          : eq(s.terminals.locationId, loc.id),
      );
  });
  return { organizationId: org.id, locationId: loc.id };
}
