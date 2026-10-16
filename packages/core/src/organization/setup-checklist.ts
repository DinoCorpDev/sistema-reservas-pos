import { asCountry, isValidTaxId } from '../shared/countries';

/**
 * Setup checklist of a location (RF-A11): what is still missing before the restaurant can operate.
 * Pure function over a snapshot the repository builds; the backoffice shows it and only lets the
 * owner activate operation when every required item is done.
 */
export interface SetupSnapshot {
  location: {
    name: string;
    legalName: string;
    street: string;
    postalCode: string;
    city: string;
    vatUid: string | null;
    defaultLanguage: string;
    languages: readonly string[];
    /** A counter service (café, bar) needs no floor plan (DEC-045). */
    serviceStyle?: 'tables' | 'counter';
    /** CH or CO: the tax id is a UID or a NIT (DEC-047). */
    country?: string;
  };
  activeAreas: number;
  activeTables: number;
  activePosTerminals: number;
  activeKitchenStations: number;
  /**
   * Active stations whose tickets nobody would see: no active kitchen display and no active
   * printer (RF-C20, RF-C26). Their items would reach the kitchen nowhere.
   */
  stationsWithoutOutput: number;
  activeReceiptPrinters: number;
  /** Active users at the location with a PIN and the `approval.grant` permission. */
  managersWithPin: number;
  tax: {
    /** Tax categories used by active products. */
    categoriesInUse: number;
    /** Of those, how many have a rule and a rate in force today for every consumption type. */
    categoriesResolvable: number;
  };
  catalog: {
    activeProducts: number;
    /** Active products without any kitchen station route at this location (RF-B11). */
    unroutedProducts: number;
    /** Active products that fail RN-18 (allergens or origin missing). */
    unpublishableProducts: number;
    /** Active products without a name in at least one other location language (RF-B07). */
    untranslatedProducts: number;
  };
}

export const SETUP_CHECKS = [
  'location_details',
  'vat_uid',
  'languages',
  'areas',
  'tables',
  'pos_terminal',
  'kitchen_station',
  'station_output',
  'receipt_printer',
  'manager_with_pin',
  'tax_rules',
  'products',
  'product_routing',
  'product_publication',
  'product_translations',
] as const;
export type SetupCheckKey = (typeof SETUP_CHECKS)[number];

export interface SetupCheck {
  key: SetupCheckKey;
  done: boolean;
  /** How many things are still missing, when it can be counted. */
  missing?: number;
}

export interface SetupChecklist {
  checks: SetupCheck[];
  done: number;
  total: number;
  complete: boolean;
}

const filled = (value: string | null | undefined) => !!value && value.trim() !== '';

export function computeSetupChecklist(snapshot: SetupSnapshot): SetupChecklist {
  const { location, tax, catalog } = snapshot;
  const otherLanguages = location.languages.filter((l) => l !== location.defaultLanguage);
  const atLeast = (count: number, key: SetupCheckKey): SetupCheck => ({
    key,
    done: count >= 1,
    ...(count >= 1 ? {} : { missing: 1 }),
  });
  const none = (count: number, key: SetupCheckKey): SetupCheck => ({
    key,
    done: count === 0,
    ...(count === 0 ? {} : { missing: count }),
  });

  const checks: SetupCheck[] = [
    {
      key: 'location_details',
      done: [
        location.name,
        location.legalName,
        location.street,
        location.postalCode,
        location.city,
      ].every(filled),
    },
    {
      key: 'vat_uid',
      done: !!location.vatUid && isValidTaxId(asCountry(location.country), location.vatUid),
    },
    // RF-B07: at least the location language plus one more.
    {
      key: 'languages',
      done: location.languages.includes(location.defaultLanguage) && otherLanguages.length >= 1,
    },
    ...(location.serviceStyle === 'counter'
      ? [
          { key: 'areas' as const, done: true },
          { key: 'tables' as const, done: true },
        ]
      : [atLeast(snapshot.activeAreas, 'areas'), atLeast(snapshot.activeTables, 'tables')]),
    atLeast(snapshot.activePosTerminals, 'pos_terminal'),
    atLeast(snapshot.activeKitchenStations, 'kitchen_station'),
    none(snapshot.stationsWithoutOutput, 'station_output'),
    atLeast(snapshot.activeReceiptPrinters, 'receipt_printer'),
    atLeast(snapshot.managersWithPin, 'manager_with_pin'),
    {
      key: 'tax_rules',
      done: tax.categoriesResolvable === tax.categoriesInUse,
      ...(tax.categoriesResolvable === tax.categoriesInUse
        ? {}
        : { missing: tax.categoriesInUse - tax.categoriesResolvable }),
    },
    atLeast(catalog.activeProducts, 'products'),
    none(catalog.unroutedProducts, 'product_routing'),
    none(catalog.unpublishableProducts, 'product_publication'),
    none(catalog.untranslatedProducts, 'product_translations'),
  ];
  const done = checks.filter((c) => c.done).length;
  return { checks, done, total: checks.length, complete: done === checks.length };
}
