import { describe, expect, it } from 'vitest';
import { computeSetupChecklist, SETUP_CHECKS, type SetupSnapshot } from './setup-checklist';

const ready: SetupSnapshot = {
  location: {
    name: 'Restaurant Demo Zürich',
    legalName: 'Demo Gastro AG',
    street: 'Musterstrasse 1',
    postalCode: '8001',
    city: 'Zürich',
    vatUid: 'CHE-123.456.788 MWST',
    defaultLanguage: 'de',
    languages: ['de', 'fr', 'it', 'en'],
  },
  activeAreas: 2,
  activeTables: 12,
  activePosTerminals: 1,
  activeKitchenStations: 3,
  stationsWithoutOutput: 0,
  activeReceiptPrinters: 1,
  managersWithPin: 2,
  tax: { categoriesInUse: 3, categoriesResolvable: 3 },
  catalog: {
    activeProducts: 30,
    unroutedProducts: 0,
    unpublishableProducts: 0,
    untranslatedProducts: 0,
  },
};

describe('RF-A11 · setup checklist', () => {
  it('is complete for a fully configured location', () => {
    const checklist = computeSetupChecklist(ready);
    expect(checklist.complete).toBe(true);
    expect(checklist.done).toBe(SETUP_CHECKS.length);
    expect(checklist.checks.map((c) => c.key)).toEqual([...SETUP_CHECKS]);
  });

  it('lists everything a brand-new restaurant still needs', () => {
    const empty: SetupSnapshot = {
      ...ready,
      location: { ...ready.location, vatUid: null, languages: ['de'] },
      activeAreas: 0,
      activeTables: 0,
      activePosTerminals: 0,
      activeKitchenStations: 0,
      activeReceiptPrinters: 0,
      managersWithPin: 0,
      tax: { categoriesInUse: 0, categoriesResolvable: 0 },
      catalog: {
        activeProducts: 0,
        unroutedProducts: 0,
        unpublishableProducts: 0,
        untranslatedProducts: 0,
      },
    };
    const checklist = computeSetupChecklist(empty);
    expect(checklist.complete).toBe(false);
    expect(checklist.checks.filter((c) => !c.done).map((c) => c.key)).toEqual([
      'vat_uid',
      'languages',
      'areas',
      'tables',
      'pos_terminal',
      'kitchen_station',
      'receipt_printer',
      'manager_with_pin',
      'products',
    ]);
  });

  it('counts what is missing in the catalog and the tax setup', () => {
    const checklist = computeSetupChecklist({
      ...ready,
      tax: { categoriesInUse: 3, categoriesResolvable: 2 },
      catalog: {
        activeProducts: 30,
        unroutedProducts: 2,
        unpublishableProducts: 4,
        untranslatedProducts: 1,
      },
    });
    const byKey = Object.fromEntries(checklist.checks.map((c) => [c.key, c]));
    expect(byKey.tax_rules).toEqual({ key: 'tax_rules', done: false, missing: 1 });
    expect(byKey.product_routing).toEqual({ key: 'product_routing', done: false, missing: 2 });
    expect(byKey.product_publication).toEqual({
      key: 'product_publication',
      done: false,
      missing: 4,
    });
    expect(byKey.product_translations).toEqual({
      key: 'product_translations',
      done: false,
      missing: 1,
    });
  });

  it('flags a kitchen station whose tickets nobody would see (no KDS, no printer)', () => {
    const checklist = computeSetupChecklist({ ...ready, stationsWithoutOutput: 1 });
    expect(checklist.complete).toBe(false);
    expect(checklist.checks.filter((c) => !c.done)).toEqual([
      { key: 'station_output', done: false, missing: 1 },
    ]);
  });

  it('requires a valid Swiss UID and complete address', () => {
    const checklist = computeSetupChecklist({
      ...ready,
      location: { ...ready.location, vatUid: 'CHE-123.456.789', street: ' ' },
    });
    const failed = checklist.checks.filter((c) => !c.done).map((c) => c.key);
    expect(failed).toEqual(['location_details', 'vat_uid']);
  });
});
