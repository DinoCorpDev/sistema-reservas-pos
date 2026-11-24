import { createHash } from 'node:crypto';
import { type Appearance, appearanceSchema, parseAppearance } from '@pos/core';
import { runCommand, schema as s } from '@pos/db';
import { eq } from 'drizzle-orm';
import { type Actor, assertPermission } from '../actor';
import type { ServiceDeps } from './shared';

/**
 * The restaurant's own look (DEC-058): colours, fonts and logo of the organization, applied to
 * its backoffice, tills and kitchen screens. Null in the database = Zitas.
 */

export async function getAppearance(deps: ServiceDeps, actor: Actor): Promise<Appearance> {
  const [row] = await deps.db
    .select({ appearance: s.organizations.appearance })
    .from(s.organizations)
    .where(eq(s.organizations.id, actor.organizationId));
  return parseAppearance(row?.appearance);
}

/** What the audit keeps of a logo: never the image, only what tells two versions apart. */
const logoTrace = (logo: string | null) =>
  logo
    ? {
        sha256: createHash('sha256').update(logo).digest('hex').slice(0, 16),
        bytes: Math.round((logo.length * 3) / 4),
      }
    : null;

const auditView = (appearance: Appearance) => ({
  colors: appearance.colors,
  fonts: appearance.fonts,
  logo: { light: logoTrace(appearance.logo.light), dark: logoTrace(appearance.logo.dark) },
});

/** Replaces the brand as a whole; devices pick it up with the next configuration check. */
export async function updateAppearance(
  deps: ServiceDeps,
  actor: Actor,
  input: unknown,
): Promise<Appearance> {
  assertPermission(actor, 'location.manage');
  const appearance = appearanceSchema.parse(input);
  const before = await getAppearance(deps, actor);
  await runCommand(deps.db, { ...actor, locationId: null }, async (tx, recorder) => {
    await tx
      .update(s.organizations)
      .set({ appearance })
      .where(eq(s.organizations.id, actor.organizationId));
    recorder.audit({
      action: 'organization.appearance_changed',
      entityType: 'organization',
      entityId: actor.organizationId,
      before: auditView(before),
      after: auditView(appearance),
    });
  });
  return appearance;
}
