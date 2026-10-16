import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { type Allergen, onboardOrganizationSchema } from '@pos/core';
import { createDb, hashPassword, schema as s } from '@pos/db';
import { eq } from 'drizzle-orm';
import type { Actor } from '../actor';
import { loadUserPermissions } from '../auth/permissions';
import { activateOperation } from '../services/admin/setup';
import { onboardOrganization } from '../services/admin/support';
import { createArea, createTable } from '../services/locations';
import * as catalog from '../services/catalog';
import * as people from '../services/people';

/**
 * «Café Demo Bogotá» (DEC-047): a Colombian demo restaurant in pesos with INC 8 %, created
 * through the same use cases as /support and the backoffice. Idempotent: an existing one is
 * left alone. The menu comes next from scripts/menus/cafe-bogota.json (`demo:colombia` runs
 * both). Development and sales demos only.
 *
 * Backoffice: admin@cafe-bogota.test with DEMO_PASSWORD below. PINs as in the Swiss demo:
 * 1000 admin, 2000 gerente, 3000 caja, 4001 mesera, 5000 cocina.
 */

const DEMO_SLUG = 'cafe-demo-bogota';
const DEMO_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'demo-bogota-2026';
const STAFF = [
  { displayName: 'Valentina Gómez', roles: ['manager'], pin: '2000' },
  { displayName: 'Andrés Rojas', roles: ['cashier', 'waiter'], pin: '3000' },
  { displayName: 'Camila Torres', roles: ['waiter'], pin: '4001' },
  { displayName: 'Julián Pérez', roles: ['kitchen'], pin: '5000' },
] as const;

/** Allergens of the demo menu by SKU (RF-B05). */
const DEMO_ALLERGENS: Record<string, Allergen[]> = {
  'CAFE-CAPUCHINO': ['milk'],
  'CAFE-LATTE': ['milk'],
  'CAFE-PERICO': ['milk'],
  'CAFE-CHOCOLATE': ['milk', 'gluten', 'eggs'],
  'FRIA-JUGO-NATURAL': ['milk'],
  'FRIA-CERVEZA': ['gluten'],
  'DESAYUNO-CALENTADO': ['eggs'],
  'DESAYUNO-HUEVOS-PERICOS': ['eggs'],
  'DESAYUNO-CHANGUA': ['milk', 'eggs', 'gluten'],
  'COMER-AREPA-QUESO': ['milk'],
  'COMER-EMPANADAS': ['gluten'],
  'COMER-SANDUCHE': ['gluten', 'milk'],
  'COMER-AJIACO': ['milk'],
  'POSTRE-ALMOJABANA': ['milk', 'eggs'],
  'POSTRE-PANDEBONO': ['milk', 'eggs'],
  'POSTRE-TRES-LECHES': ['milk', 'eggs', 'gluten'],
  'POSTRE-OBLEA': ['milk', 'gluten'],
};

const rootEnv = resolve(import.meta.dirname, '../../../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
const { db, pool } = createDb(process.env.DATABASE_URL!, { connectionLimit: 2 });
const deps = { db };

const activate = process.argv.includes('--activate');

try {
  if (activate) {
    await activateDemo();
    console.log('✓ Café Demo Bogotá: operation active');
    process.exit(0);
  }
  const [existing] = await db
    .select({ id: s.organizations.id })
    .from(s.organizations)
    .where(eq(s.organizations.slug, DEMO_SLUG));
  if (existing) {
    console.log(`• ${DEMO_SLUG} already exists; nothing to do`);
  } else {
    const [staff] = await db.select({ id: s.platformStaff.id }).from(s.platformStaff).limit(1);
    if (!staff) throw new Error('A support account is needed first (pnpm db:setup)');
    const created = await onboardOrganization(
      deps,
      { staffId: staff.id },
      onboardOrganizationSchema.parse({
        profile: 'restaurant',
        country: 'CO',
        taxRegime: 'inc',
        organization: {
          name: 'Café Demo Bogotá',
          legalName: 'Café Demo Bogotá SAS',
          defaultLanguage: 'es',
        },
        location: {
          name: 'Café Demo Bogotá',
          legalName: 'Café Demo Bogotá SAS',
          street: 'Calle 85 # 12-30',
          postalCode: '110221',
          city: 'Bogotá',
          vatUid: '900123456-8',
          languages: ['es', 'en'],
          kitchenLanguage: 'es',
        },
        owner: {
          displayName: 'Laura Martínez',
          email: 'admin@cafe-bogota.test',
          uiLanguage: 'es',
        },
      }),
    );
    // The slug is the one this script looks for.
    await db
      .update(s.organizations)
      .set({ slug: DEMO_SLUG })
      .where(eq(s.organizations.id, created.organizationId));
    // A known password for the demo instead of the temporary one.
    await db
      .update(s.users)
      .set({ passwordHash: await hashPassword(DEMO_PASSWORD), mustChangePassword: false })
      .where(eq(s.users.id, created.ownerUserId));

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
    // The owner opens the POS too.
    await people.setUserPin(deps, actor, created.ownerUserId, { pin: '1000' });
    for (const person of STAFF) {
      await people.createUser(deps, actor, {
        displayName: person.displayName,
        email: null,
        password: null,
        pin: person.pin,
        uiLanguage: 'es',
        roles: [...person.roles],
        locationIds: [created.locationId],
      });
    }

    const cocina = await people.createKitchenStation(deps, actor, {
      name: 'Cocina',
      alertAfterMinutes: null,
      language: null,
      printerId: null,
      fallbackStationId: null,
      sortOrder: 0,
      isActive: true,
    });
    const barra = await people.createKitchenStation(deps, actor, {
      name: 'Barra',
      alertAfterMinutes: null,
      language: null,
      printerId: null,
      fallbackStationId: null,
      sortOrder: 1,
      isActive: true,
    });
    const terminal = (
      name: string,
      type: 'pos' | 'kds',
      prefix: string,
      stationId: string | null,
    ) =>
      people.createTerminal(deps, actor, {
        name,
        type,
        orderNumberPrefix: prefix,
        kitchenStationId: stationId,
        receiptPrinterId: null,
      });
    await terminal('Caja 1', 'pos', 'C1', null);
    await terminal('Cocina', 'kds', 'KC', cocina.id);
    await terminal('Barra', 'kds', 'KB', barra.id);

    const salon = await createArea(deps, actor, {
      name: 'Salón',
      qrMode: 'view',
      sortOrder: 0,
      isActive: true,
    });
    for (const [index, label] of ['1', '2', '3', '4', '5', '6'].entries()) {
      await createTable(deps, actor, {
        areaId: salon.id,
        label,
        capacity: index % 3 === 2 ? 6 : 4,
        shape: index % 3 === 2 ? 'round' : 'rect',
        posX: (index % 3) * 2,
        posY: Math.trunc(index / 3) * 2,
        width: 1,
        height: 1,
        qrMode: null,
        isActive: true,
      });
    }
    console.log(`✓ Café Demo Bogotá created (${created.organizationId})`);
  }
} finally {
  await pool.end();
}

/** After the menu import: the operation starts once the checklist is complete (RF-A11). */
async function activateDemo(): Promise<void> {
  const database = db;
  {
    const [org] = await database
      .select()
      .from(s.organizations)
      .where(eq(s.organizations.slug, DEMO_SLUG));
    if (!org) return;
    const [location] = await database
      .select()
      .from(s.locations)
      .where(eq(s.locations.organizationId, org.id));
    const [owner] = await database
      .select()
      .from(s.users)
      .where(eq(s.users.email, 'admin@cafe-bogota.test'));
    if (!location || !owner) return;
    const actor: Actor = {
      kind: 'user',
      organizationId: org.id,
      locationId: location.id,
      userId: owner.id,
      permissions: await loadUserPermissions(database, {
        organizationId: org.id,
        userId: owner.id,
        locationId: location.id,
      }),
      requestId: null,
    };
    // A receipt printer for the till (the hub prints when there is one; DEC-031).
    const printers = await people.listPrinters({ db: database }, actor);
    if (!printers.some((printer) => printer.kind === 'receipt')) {
      const printer = await people.createPrinter({ db: database }, actor, {
        name: 'Impresora caja',
        kind: 'receipt',
        protocol: 'escpos',
        host: '192.168.1.50',
        port: 9100,
        paperWidthMm: 80,
        hasCashDrawer: true,
        isActive: true,
      });
      const tills = (await people.listTerminals({ db: database }, actor)).filter(
        (terminal) => terminal.type === 'pos',
      );
      for (const till of tills) {
        await people.updateTerminal({ db: database }, actor, till.id, {
          receiptPrinterId: printer.id,
        });
      }
    }
    // Allergens of the demo menu, reviewed (RN-18): a product is published only with them.
    for (const product of await catalog.listProducts({ db: database }, actor, {})) {
      if (product.allergensComplete) continue;
      await catalog.replaceAllergens({ db: database }, actor, product.id, {
        allergens: (DEMO_ALLERGENS[product.sku ?? ''] ?? []).map((allergen) => ({
          allergen,
          presence: 'contains',
        })),
        confirmed: true,
      });
    }
    await activateOperation({ db: database }, actor);
  }
}
