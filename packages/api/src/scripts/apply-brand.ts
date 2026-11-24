import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { createDb, inOrg, schema as s } from '@pos/db';
import { and, eq } from 'drizzle-orm';
import type { Actor } from '../actor';
import { loadUserPermissions } from '../auth/permissions';
import { updateAppearance } from '../services/appearance';

/**
 * Applies a restaurant's brand from a folder (DEC-058) through the same use case as the
 * backoffice «Brand» page: validated and audited. Repeatable.
 *
 *   pnpm --filter @pos/api brand:apply ../../scripts/brands/lalin-tapas --org=lalin-tapas
 *
 * The folder holds `appearance.json` ({ colors, fonts, logo: { light, dark } }); a logo is the
 * name of an image file next to it, turned into a data URL here.
 */

const MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

const args = process.argv.slice(2);
const folder = args.find((arg) => !arg.startsWith('--'));
const orgSlug = args.find((arg) => arg.startsWith('--org='))?.slice(6);
if (!folder || !orgSlug) {
  console.error('Usage: brand:apply <folder> --org=<slug>');
  process.exit(1);
}

const rootEnv = resolve(import.meta.dirname, '../../../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
const dir = resolve(process.cwd(), folder);
const brand = JSON.parse(readFileSync(resolve(dir, 'appearance.json'), 'utf8')) as {
  colors: Record<string, string> | null;
  fonts: string;
  logo?: { light?: string | null; dark?: string | null };
};
const asDataUrl = (file: string | null | undefined) => {
  if (!file) return null;
  const type = MEDIA_TYPES[extname(file).toLowerCase()];
  if (!type) throw new Error(`Not an image: ${file}`);
  return `data:${type};base64,${readFileSync(resolve(dir, file)).toString('base64')}`;
};

const { db, pool } = createDb(process.env.DATABASE_URL!, { connectionLimit: 2 });
try {
  const [org] = await db.select().from(s.organizations).where(eq(s.organizations.slug, orgSlug));
  if (!org) throw new Error(`Organization ${orgSlug} not found`);
  const tenant = { organizationId: org.id };
  const [location] = await db
    .select({ id: s.locations.id })
    .from(s.locations)
    .where(inOrg(s.locations, tenant))
    .limit(1);
  const [admin] = await db
    .select({ id: s.users.id })
    .from(s.users)
    .innerJoin(s.userRoles, eq(s.userRoles.userId, s.users.id))
    .innerJoin(s.roles, eq(s.roles.id, s.userRoles.roleId))
    .where(and(inOrg(s.users, tenant), eq(s.roles.key, 'admin'), eq(s.users.isActive, true)))
    .limit(1);
  if (!admin || !location) throw new Error('The organization needs a location and an admin');
  const actor: Actor = {
    kind: 'user',
    organizationId: org.id,
    locationId: location.id,
    userId: admin.id,
    permissions: await loadUserPermissions(db, {
      organizationId: org.id,
      userId: admin.id,
      locationId: location.id,
    }),
    requestId: null,
  };
  const saved = await updateAppearance({ db }, actor, {
    colors: brand.colors,
    fonts: brand.fonts,
    logo: { light: asDataUrl(brand.logo?.light), dark: asDataUrl(brand.logo?.dark) },
  });
  console.log(
    `✓ Brand of ${org.name}: fonts ${saved.fonts}, colours ${JSON.stringify(saved.colors)}, ` +
      `logo ${saved.logo.light ? 'light' : '-'}/${saved.logo.dark ? 'dark' : '-'}`,
  );
} finally {
  await pool.end();
}
