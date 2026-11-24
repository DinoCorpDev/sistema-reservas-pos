import { randomInt } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { onboardOrganizationSchema } from '@pos/core';
import { createDb, schema as s } from '@pos/db';
import { eq } from 'drizzle-orm';
import type { Actor } from '../actor';
import { loadUserPermissions } from '../auth/permissions';
import { onboardOrganization } from '../services/admin/support';
import { createArea, createTable } from '../services/locations';
import * as people from '../services/people';

/**
 * «Lalín Tapas & More» (Zürich): the restaurant created through the same use cases as /support
 * and the backoffice, ready for its menu and recipes. Idempotent: an existing one is left alone.
 *
 *   pnpm --filter @pos/api lalin:setup --email=<owner e-mail>
 *   pnpm --filter @pos/api menu:import ../../scripts/menus/lalin-tapas.json --org=lalin-tapas
 *   pnpm --filter @pos/api recipes:import ../../scripts/menus/lalin-tapas-recipes.json --org=lalin-tapas
 *
 * It prints the owner's temporary password (changed at the first sign-in) and PIN; neither is
 * stored here. Left for the owner, because only they can vouch for them: the UID, the receipt
 * printer's address, the allergens of each dish and the real floor plan (from a photo).
 */

const SLUG = 'lalin-tapas';
const args = process.argv.slice(2);
const email = args.find((arg) => arg.startsWith('--email='))?.slice(8);
if (!email) {
  console.error('Usage: lalin:setup --email=<owner e-mail>');
  process.exit(1);
}

const rootEnv = resolve(import.meta.dirname, '../../../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
const { db, pool } = createDb(process.env.DATABASE_URL!, { connectionLimit: 2 });
const deps = { db };

const station = (name: string, sortOrder: number, fallbackStationId: string | null = null) => ({
  name,
  alertAfterMinutes: null,
  language: null,
  printerId: null,
  fallbackStationId,
  sortOrder,
  isActive: true,
});

try {
  const [existing] = await db
    .select({ id: s.organizations.id })
    .from(s.organizations)
    .where(eq(s.organizations.slug, SLUG));
  if (existing) {
    console.log(`• ${SLUG} already exists; nothing to do`);
    process.exit(0);
  }
  const [staff] = await db.select({ id: s.platformStaff.id }).from(s.platformStaff).limit(1);
  if (!staff) throw new Error('A support account is needed first');

  const created = await onboardOrganization(
    deps,
    { staffId: staff.id },
    onboardOrganizationSchema.parse({
      profile: 'restaurant',
      country: 'CH',
      organization: {
        name: 'Lalín Tapas & More',
        legalName: 'Lalín Tapas & More',
        defaultLanguage: 'de',
      },
      location: {
        name: 'Lalín Tapas & More',
        legalName: 'Lalín Tapas & More',
        street: 'Zentralstrasse 111',
        postalCode: '8003',
        city: 'Zürich',
        canton: 'ZH',
        vatUid: null,
        // The menu is in German with English translations (scripts/menus/lalin-tapas.json).
        languages: ['de', 'en'],
        kitchenLanguage: 'de',
      },
      owner: { displayName: 'Lalín Tapas', email, uiLanguage: 'es' },
    }),
  );
  await db
    .update(s.organizations)
    .set({ slug: SLUG })
    .where(eq(s.organizations.id, created.organizationId));

  const actor: Actor = {
    kind: 'user',
    organizationId: created.organizationId,
    locationId: created.locationId,
    userId: created.ownerUserId,
    permissions: await loadUserPermissions(db, {
      organizationId: created.organizationId,
      userId: created.ownerUserId,
      locationId: created.locationId,
    }),
    requestId: null,
  };
  // The owner approves at the till (voids, discounts) with this PIN.
  const pin = String(randomInt(1000, 10000));
  await people.setUserPin(deps, actor, created.ownerUserId, { pin });

  // The stations the menu routes to; desserts show on the kitchen screen.
  const kitchen = await people.createKitchenStation(deps, actor, station('Küche', 0));
  const bar = await people.createKitchenStation(deps, actor, station('Bar', 1));
  await people.createKitchenStation(deps, actor, station('Patisserie', 2, kitchen.id));
  const terminal = (name: string, type: 'pos' | 'kds', prefix: string, stationId: string | null) =>
    people.createTerminal(deps, actor, {
      name,
      type,
      orderNumberPrefix: prefix,
      kitchenStationId: stationId,
      receiptPrinterId: null,
    });
  await terminal('Kasse 1', 'pos', 'K1', null);
  await terminal('Küche', 'kds', 'KU', kitchen.id);
  await terminal('Bar', 'kds', 'BA', bar.id);

  // A first room of ten tables for four; the owner draws the real one (or reads it from a photo).
  const room = await createArea(deps, actor, {
    name: 'Restaurant',
    qrMode: 'view',
    sortOrder: 0,
    isActive: true,
  });
  for (let index = 0; index < 10; index += 1) {
    await createTable(deps, actor, {
      areaId: room.id,
      label: String(index + 1),
      capacity: 4,
      shape: 'rect',
      posX: (index % 5) * 2,
      posY: Math.trunc(index / 5) * 2,
      width: 1,
      height: 1,
      qrMode: null,
      isActive: true,
    });
  }

  console.log(`✓ Lalín Tapas & More created (${created.organizationId})`);
  console.log(`  Backoffice: ${email} · temporary password ${created.temporaryPassword}`);
  console.log(`  Owner PIN at the till: ${pin}`);
} finally {
  await pool.end();
}
