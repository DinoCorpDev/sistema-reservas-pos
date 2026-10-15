import {
  businessDate,
  type CatalogSnapshot,
  type ConsumptionType,
  type ContentLanguage,
  type TaxCategoryKey,
  type TaxRateCode,
  type TaxRateRecord,
  type TaxRuleRecord,
} from '@pos/core';
import { inLocation, inOrg, notDeleted, schema as s } from '@pos/db';
import { and, asc, eq, like } from 'drizzle-orm';
import { type Actor, requireTerminal } from '../../actor';
import { notFound } from '../../errors';
import { loadCatalogSnapshot } from '../catalog/snapshot';
import { listAreas, listTables, toLocationDto } from '../locations';
import type { ServiceDeps } from '../shared';
import { configVersion } from '../sync/config-version';
import { subscriptionStatusOf } from '../platform/plans';

/**
 * `GET /pos/bootstrap` (docs/SYNC.md §6.4): everything a paired terminal needs to operate
 * without network: the location with its receipt data and settings, floor, stations, users,
 * the raw catalog, tax categories with dated rates and rules (RN-02, data, never constants), and
 * the counters this terminal already used today. The device evaluates prices, availability and
 * MWST with the same @pos/core functions as the server.
 */
export async function getBootstrap(deps: ServiceDeps, actor: Actor) {
  const { terminalId, locationId } = requireTerminal(actor);
  const { db } = deps;
  const [terminal] = await db
    .select()
    .from(s.terminals)
    .where(inLocation(s.terminals, actor, eq(s.terminals.id, terminalId), notDeleted(s.terminals)));
  if (!terminal) throw notFound('Terminal');
  const [locationRow] = await db
    .select()
    .from(s.locations)
    .where(inOrg(s.locations, actor, eq(s.locations.id, locationId), notDeleted(s.locations)));
  if (!locationRow) throw notFound('Location');
  const location = toLocationDto(locationRow);
  const [organization] = await db
    .select({ id: s.organizations.id, name: s.organizations.name })
    .from(s.organizations)
    .where(eq(s.organizations.id, actor.organizationId));

  const [
    areas,
    tables,
    stations,
    printers,
    displays,
    users,
    categories,
    rates,
    rules,
    catalog,
    version,
  ] = await Promise.all([
    listAreas(deps, actor),
    listTables(deps, actor),
    // Routing, delay alert, kitchen language and printer of each station (RF-C21…RF-C26).
    db
      .select({
        id: s.kitchenStations.id,
        name: s.kitchenStations.name,
        alertAfterMinutes: s.kitchenStations.alertAfterMinutes,
        language: s.kitchenStations.language,
        printerId: s.kitchenStations.printerId,
        fallbackStationId: s.kitchenStations.fallbackStationId,
        sortOrder: s.kitchenStations.sortOrder,
        isActive: s.kitchenStations.isActive,
      })
      .from(s.kitchenStations)
      .where(inLocation(s.kitchenStations, actor, notDeleted(s.kitchenStations)))
      .orderBy(asc(s.kitchenStations.sortOrder), asc(s.kitchenStations.name)),
    // Printers of the location: the hub prints on them (DEC-031); the POS knows whether its
    // receipt printer exists. `testRequestedAt` tells the hub a test page is due (DEC-032).
    db
      .select({
        id: s.printers.id,
        name: s.printers.name,
        kind: s.printers.kind,
        protocol: s.printers.protocol,
        host: s.printers.host,
        port: s.printers.port,
        paperWidthMm: s.printers.paperWidthMm,
        hasCashDrawer: s.printers.hasCashDrawer,
        isActive: s.printers.isActive,
        testRequestedAt: s.printers.testRequestedAt,
      })
      .from(s.printers)
      .where(inLocation(s.printers, actor, notDeleted(s.printers)))
      .orderBy(asc(s.printers.name)),
    // Kitchen displays of each station, paired or not: with presence, the POS knows whether
    // someone is at one of them and sends to the replacement station if not (DEC-033).
    db
      .select({
        terminalId: s.terminals.id,
        name: s.terminals.name,
        kitchenStationId: s.terminals.kitchenStationId,
      })
      .from(s.terminals)
      .where(
        inLocation(
          s.terminals,
          actor,
          eq(s.terminals.type, 'kds'),
          eq(s.terminals.isActive, true),
          notDeleted(s.terminals),
        ),
      )
      .orderBy(asc(s.terminals.name)),
    db
      .select({ id: s.users.id, displayName: s.users.displayName })
      .from(s.users)
      .innerJoin(s.userLocations, eq(s.userLocations.userId, s.users.id))
      .where(
        inOrg(
          s.users,
          actor,
          eq(s.users.isActive, true),
          notDeleted(s.users),
          eq(s.userLocations.locationId, locationId),
          notDeleted(s.userLocations),
        ),
      )
      .orderBy(asc(s.users.displayName)),
    db
      .select({ id: s.taxCategories.id, key: s.taxCategories.key, name: s.taxCategories.name })
      .from(s.taxCategories)
      .where(inOrg(s.taxCategories, actor, notDeleted(s.taxCategories))),
    db
      .select()
      .from(s.taxRates)
      .where(inOrg(s.taxRates, actor, notDeleted(s.taxRates))),
    db
      .select({ rule: s.taxRules, taxCategoryKey: s.taxCategories.key })
      .from(s.taxRules)
      .innerJoin(s.taxCategories, eq(s.taxCategories.id, s.taxRules.taxCategoryId))
      .where(inOrg(s.taxRules, actor, notDeleted(s.taxRules))),
    loadCatalogSnapshot(db, actor, locationId),
    configVersion(db, { organizationId: actor.organizationId, locationId }),
  ]);

  // Counters this terminal already used today, so a reinstalled device never repeats a number
  // (docs/SYNC.md §8): offline order numbers by prefix and receipt numbers by prefix and day.
  const today = businessDate(new Date(), location.timezone, location.settings.businessDayStartsAt);
  const prefix = terminal.orderNumberPrefix;
  const [orderSequence] = await db
    .select({ lastNumber: s.orderNumberSequences.lastNumber })
    .from(s.orderNumberSequences)
    .where(
      and(
        eq(s.orderNumberSequences.locationId, locationId),
        eq(s.orderNumberSequences.businessDate, today),
        eq(s.orderNumberSequences.prefix, prefix),
      ),
    );
  const receiptPrefix = `${prefix}-${today.slice(2).replaceAll('-', '')}-`;
  const receiptNumbers = await db
    .select({ receiptNumber: s.receipts.receiptNumber })
    .from(s.receipts)
    .where(
      and(
        eq(s.receipts.locationId, locationId),
        like(s.receipts.receiptNumber, `${receiptPrefix}%`),
      ),
    );
  const lastReceipt = receiptNumbers.reduce((highest, row) => {
    const counter = Number.parseInt(row.receiptNumber.slice(receiptPrefix.length), 10);
    return Number.isFinite(counter) && counter > highest ? counter : highest;
  }, 0);

  const catalogSnapshot: CatalogSnapshot = catalog;
  return {
    configVersion: version,
    serverTime: new Date().toISOString(),
    organization: { id: actor.organizationId, name: organization?.name ?? '' },
    /** A late payment shows a notice; suspended adds nothing new (DEC-045). */
    subscriptionStatus: await subscriptionStatusOf(db, actor.organizationId),
    terminal: {
      id: terminal.id,
      name: terminal.name,
      type: terminal.type,
      orderNumberPrefix: terminal.orderNumberPrefix,
      receiptPrinterId: terminal.receiptPrinterId,
      kitchenStationId: terminal.kitchenStationId,
      /** A waiter's own phone opens only with its owner's PIN (DEC-036). */
      userId: terminal.userId,
    },
    location,
    areas,
    tables,
    stations: stations.map((station) => ({
      ...station,
      language: station.language as ContentLanguage | null,
    })),
    printers: printers.map((printer) => ({
      ...printer,
      testRequestedAt: printer.testRequestedAt?.toISOString() ?? null,
    })),
    kitchenDisplays: displays,
    users,
    tax: {
      categories: categories.map((c) => ({ id: c.id, key: c.key as TaxCategoryKey, name: c.name })),
      rates: rates.map((r): TaxRateRecord => ({
        code: r.code as TaxRateCode,
        rateBp: r.rateBp,
        validFrom: r.validFrom,
        validTo: r.validTo,
      })),
      rules: rules.map(({ rule, taxCategoryKey }): TaxRuleRecord => ({
        taxCategoryKey: taxCategoryKey as TaxCategoryKey,
        consumptionType: rule.consumptionType as ConsumptionType,
        rateCode: rule.rateCode as TaxRateCode,
        validFrom: rule.validFrom,
        validTo: rule.validTo,
      })),
    },
    catalog: catalogSnapshot,
    counters: { businessDate: today, lastOrderNumber: orderSequence?.lastNumber ?? 0, lastReceipt },
  };
}
export type BootstrapDto = Awaited<ReturnType<typeof getBootstrap>>;
