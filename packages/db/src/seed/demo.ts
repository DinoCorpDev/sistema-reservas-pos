import { randomBytes } from 'node:crypto';
import {
  DEFAULT_LOCATION_SETTINGS,
  newId,
  parseChf,
  type ContentLanguage,
  type TranslatableEntity,
} from '@pos/core';
import { eq } from 'drizzle-orm';
import type { Database } from '../client';
import * as s from '../schema';
import { hashPassword, pinLookup } from '../security';
import { applyOrganizationTemplate, newPinKey } from '../templates/organization';
import {
  SEED_CATEGORIES,
  SEED_MODIFIER_GROUPS,
  SEED_PRODUCTS,
  type CategoryKey,
  type ModifierGroupKey,
  type StationKey,
} from './data/catalog';
import {
  DEMO_AREAS,
  DEMO_BACKOFFICE_PASSWORD,
  DEMO_CONSENT_TEXT,
  DEMO_CUSTOMERS,
  DEMO_LOCATION,
  DEMO_ORGANIZATION,
  DEMO_PRINTERS,
  DEMO_STATIONS,
  DEMO_SUPPORT_STAFF,
  DEMO_TERMINALS,
  DEMO_USERS,
} from './data/restaurant';

export interface SeedResult {
  status: 'created' | 'skipped';
  organizationId: string;
  locationId?: string;
}

type TranslationRow = typeof s.translations.$inferInsert;

const TRANSLATED_LANGUAGES = ['fr', 'it', 'en'] as const satisfies readonly ContentLanguage[];

/** Public QR code: 12 URL-safe characters, unguessable (RF-E06). */
function newQrCode(): string {
  return randomBytes(9).toString('base64url');
}

/**
 * Seeds the "Restaurant Demo Zürich". Idempotent: if the demo organization already exists, it does
 * nothing (use `pnpm db:setup --reset` to start over).
 */
export async function seedDemoRestaurant(db: Database): Promise<SeedResult> {
  const existing = await db
    .select({ id: s.organizations.id })
    .from(s.organizations)
    .where(eq(s.organizations.slug, DEMO_ORGANIZATION.slug))
    .limit(1);
  if (existing[0]) {
    return { status: 'skipped', organizationId: existing[0].id };
  }

  // Hash outside the transaction: argon2 is deliberately slow.
  const [backofficePasswordHash, supportPasswordHash, ...pinHashes] = await Promise.all([
    hashPassword(DEMO_BACKOFFICE_PASSWORD),
    hashPassword(DEMO_SUPPORT_STAFF.password),
    ...DEMO_USERS.map((user) => hashPassword(user.pin)),
  ]);

  const organizationId = newId();
  const locationId = newId();
  const pinKey = newPinKey();
  const org = { organizationId };
  const loc = { organizationId, locationId };

  await db.transaction(async (tx) => {
    // ── DINOLABS support account (platform level, RF-A10) ─────────────────
    const [staff] = await tx
      .select({ id: s.platformStaff.id })
      .from(s.platformStaff)
      .where(eq(s.platformStaff.email, DEMO_SUPPORT_STAFF.email));
    if (!staff) {
      await tx.insert(s.platformStaff).values({
        email: DEMO_SUPPORT_STAFF.email,
        displayName: DEMO_SUPPORT_STAFF.displayName,
        passwordHash: supportPasswordHash!,
      });
    }

    // ── Organization and location ──────────────────────────────────────────
    await tx.insert(s.organizations).values({ id: organizationId, ...DEMO_ORGANIZATION, pinKey });
    await tx.insert(s.locations).values({
      id: locationId,
      ...org,
      ...DEMO_LOCATION,
      languages: [...DEMO_LOCATION.languages],
      settings: DEFAULT_LOCATION_SETTINGS,
    });

    // ── Printers, stations, areas, tables and terminals ───────────────────
    const printerIds = new Map<string, string>();
    for (const printer of DEMO_PRINTERS) {
      const id = newId();
      printerIds.set(printer.key, id);
      await tx.insert(s.printers).values({
        id,
        ...loc,
        name: printer.name,
        kind: printer.kind,
        host: printer.host,
        hasCashDrawer: printer.hasCashDrawer,
      });
    }

    const stationIds = new Map<StationKey, string>();
    for (const [index, station] of DEMO_STATIONS.entries()) {
      const id = newId();
      stationIds.set(station.key, id);
      const printer = DEMO_PRINTERS.find((p) => p.station === station.key);
      await tx.insert(s.kitchenStations).values({
        id,
        ...loc,
        name: station.name,
        alertAfterMinutes: station.alertAfterMinutes,
        printerId: printer ? printerIds.get(printer.key) : null,
        sortOrder: index,
      });
    }

    for (const [areaIndex, area] of DEMO_AREAS.entries()) {
      const areaId = newId();
      await tx.insert(s.areas).values({
        id: areaId,
        ...loc,
        name: area.name,
        qrMode: area.qrMode,
        sortOrder: areaIndex,
      });
      await tx.insert(s.diningTables).values(
        area.tables.map((label, index) => ({
          ...loc,
          areaId,
          label,
          qrCode: newQrCode(),
          capacity: index % 3 === 2 ? 6 : index % 2 === 0 ? 4 : 2,
          shape: index % 3 === 2 ? 'round' : 'rect',
          posX: (index % 4) * 2,
          posY: Math.floor(index / 4) * 2,
          width: 1,
          height: 1,
        })),
      );
    }

    await tx.insert(s.terminals).values(
      DEMO_TERMINALS.map((terminal) => ({
        ...loc,
        name: terminal.name,
        type: terminal.type,
        orderNumberPrefix: terminal.prefix,
        kitchenStationId: terminal.station ? stationIds.get(terminal.station) : null,
        receiptPrinterId: terminal.receiptPrinter ? printerIds.get(terminal.receiptPrinter) : null,
      })),
    );

    // ── Roles, permissions and MWST from the organization template ────────
    const { roleIds, taxCategoryIds } = await applyOrganizationTemplate(tx, organizationId, 'de');

    for (const [index, user] of DEMO_USERS.entries()) {
      const userId = newId();
      await tx.insert(s.users).values({
        id: userId,
        ...org,
        displayName: user.displayName,
        email: user.email ?? null,
        passwordHash: user.email ? backofficePasswordHash : null,
        pinHash: pinHashes[index],
        pinLookup: pinLookup(pinKey, user.pin),
        uiLanguage: user.uiLanguage,
      });
      await tx.insert(s.userLocations).values({ ...org, userId, locationId });
      await tx
        .insert(s.userRoles)
        .values(user.roles.map((role) => ({ ...org, userId, roleId: roleIds[role] })));
    }

    // ── Catalog ────────────────────────────────────────────────────────────
    const translationRows: TranslationRow[] = [];
    const translate = (
      entityType: TranslatableEntity,
      entityId: string,
      texts: Record<(typeof TRANSLATED_LANGUAGES)[number], string>,
      field: 'name' | 'description' = 'name',
    ) => {
      for (const language of TRANSLATED_LANGUAGES) {
        translationRows.push({
          ...org,
          entityType,
          entityId,
          language,
          field,
          value: texts[language],
        });
      }
    };

    const categoryIds = new Map<CategoryKey, string>();
    for (const [index, category] of SEED_CATEGORIES.entries()) {
      const id = newId();
      categoryIds.set(category.key, id);
      await tx.insert(s.categories).values({ id, ...org, name: category.name, sortOrder: index });
      translate('category', id, category.i18n);
    }

    const modifierGroupIds = new Map<ModifierGroupKey, string>();
    for (const [index, group] of SEED_MODIFIER_GROUPS.entries()) {
      const groupId = newId();
      modifierGroupIds.set(group.key, groupId);
      await tx.insert(s.modifierGroups).values({
        id: groupId,
        ...org,
        name: group.name,
        minSelect: group.minSelect,
        maxSelect: group.maxSelect,
        sortOrder: index,
      });
      translate('modifier_group', groupId, group.i18n);
      for (const [modifierIndex, modifier] of group.modifiers.entries()) {
        const modifierId = newId();
        await tx.insert(s.modifiers).values({
          id: modifierId,
          ...org,
          modifierGroupId: groupId,
          name: modifier.name,
          priceDeltaRappen: parseChf(modifier.priceChf),
          sortOrder: modifierIndex,
        });
        translate('modifier', modifierId, modifier.i18n);
        if (modifier.allergens?.length) {
          await tx
            .insert(s.modifierAllergens)
            .values(modifier.allergens.map((allergen) => ({ ...org, modifierId, allergen })));
        }
      }
    }

    for (const [index, product] of SEED_PRODUCTS.entries()) {
      const productId = newId();
      await tx.insert(s.products).values({
        id: productId,
        ...org,
        categoryId: categoryIds.get(product.category)!,
        taxCategoryId: taxCategoryIds[product.taxCategory],
        sku: product.key.toUpperCase(),
        name: product.name,
        description: product.description?.de ?? null,
        basePriceRappen: parseChf(product.priceChf),
        defaultCourse: product.course,
        requiresOrigin: (product.origins?.length ?? 0) > 0,
        allergensComplete: true,
        sortOrder: index,
      });
      translate('product', productId, product.i18n);
      if (product.description) {
        translate('product', productId, product.description, 'description');
      }

      const allergenRows = [
        ...product.allergens.map((allergen) => ({ allergen, presence: 'contains' })),
        ...(product.mayContain ?? []).map((allergen) => ({ allergen, presence: 'may_contain' })),
      ];
      if (allergenRows.length > 0) {
        await tx
          .insert(s.productAllergens)
          .values(allergenRows.map((row) => ({ ...org, productId, ...row })));
      }
      if (product.origins?.length) {
        await tx
          .insert(s.productOrigins)
          .values(product.origins.map((origin) => ({ ...org, productId, ...origin })));
      }
      for (const [variantIndex, variant] of (product.variants ?? []).entries()) {
        const variantId = newId();
        await tx.insert(s.productVariants).values({
          id: variantId,
          ...org,
          productId,
          name: variant.name,
          priceRappen: parseChf(variant.priceChf),
          isDefault: variant.isDefault ?? false,
          sortOrder: variantIndex,
        });
        translate('product_variant', variantId, variant.i18n);
      }
      for (const [groupIndex, groupKey] of (product.modifierGroups ?? []).entries()) {
        await tx.insert(s.productModifierGroups).values({
          ...org,
          productId,
          modifierGroupId: modifierGroupIds.get(groupKey)!,
          sortOrder: groupIndex,
        });
      }
      for (const channelPrice of product.channelPrices ?? []) {
        await tx.insert(s.channelPrices).values({
          ...org,
          productId,
          channel: channelPrice.channel,
          priceRappen: parseChf(channelPrice.priceChf),
        });
      }
      if (product.availability) {
        await tx.insert(s.availabilityRules).values({
          ...org,
          locationId,
          productId,
          daysOfWeek: product.availability.daysOfWeek,
          startTime: product.availability.start,
          endTime: product.availability.end,
        });
      }
      await tx.insert(s.productLocationSettings).values({ ...loc, productId });
      await tx.insert(s.productStationRoutes).values(
        product.stations.map((station) => ({
          ...loc,
          productId,
          kitchenStationId: stationIds.get(station)!,
        })),
      );
    }

    await tx.insert(s.translations).values(translationRows);

    // ── Customers with consent (RN-23) ─────────────────────────────────────
    for (const customer of DEMO_CUSTOMERS) {
      const customerId = newId();
      await tx.insert(s.customers).values({
        id: customerId,
        ...org,
        ...customer,
        tags: [...customer.tags],
      });
      await tx.insert(s.consents).values({
        ...org,
        locationId,
        customerId,
        purpose: 'data_processing',
        source: 'backoffice',
        textVersion: '2026-10',
        textSnapshot: DEMO_CONSENT_TEXT,
        grantedAt: new Date(),
      });
    }
  });

  return { status: 'created', organizationId, locationId };
}
