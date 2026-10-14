import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCATION_SETTINGS } from '../organization/settings';
import { CONTENT_LANGUAGES } from '../shared/languages';
import { rappen } from '../shared/money';
import { extractTax, summarizeByRate } from '../tax/calculation';
import type { TaxRateCode } from '../tax/constants';
import {
  buildReceipt,
  formatVatNumber,
  ReceiptError,
  type ReceiptLineInput,
  type ReceiptLocation,
  receiptTaxes,
  refundTaxes,
} from './build';
import { receiptContentSchema } from './content';

const NORMAL = { code: 'normal', bp: 810 } as const;
const REDUCED = { code: 'reduced', bp: 260 } as const;

function receiptLine(
  name: string,
  unitPriceRappen: number,
  quantity: number,
  rate: { code: TaxRateCode; bp: number },
  fields: Partial<ReceiptLineInput> = {},
): ReceiptLineInput {
  const discount = fields.discountRappen ?? 0;
  const total = rappen(unitPriceRappen * quantity - discount);
  return {
    name,
    variantName: null,
    quantity,
    unitPriceRappen: rappen(unitPriceRappen),
    modifiers: [],
    discountRappen: rappen(0),
    lineTotalRappen: total,
    taxRappen: extractTax(total, rate.bp),
    taxRateCode: rate.code,
    taxRateBp: rate.bp,
    ...fields,
  };
}

/**
 * A takeaway order (RN-03): food at the reduced rate, alcohol always at the normal rate.
 * Rösti 24.50 @ 2.6 % contains 0.62 MWST; 2 × Bier 6.50 = 13.00 @ 8.1 % contains 0.97.
 */
const LINES: ReceiptLineInput[] = [
  receiptLine('Berner Rösti', 2450, 1, REDUCED),
  receiptLine('Bier', 650, 2, NORMAL),
];
const TOTAL = rappen(3750);

const LOCATION: ReceiptLocation = {
  name: 'Restaurant Demo Zürich',
  legalName: 'Demo Gastro AG',
  street: 'Bahnhofstrasse 1',
  postalCode: '8001',
  city: 'Zürich',
  vatUid: 'CHE-123.456.789',
  header: null,
  footer: 'Bis bald!',
};

type ReceiptInput = Parameters<typeof buildReceipt>[0];

function input(
  overrides: Partial<Omit<ReceiptInput, 'payment'>> & {
    payment?: Partial<ReceiptInput['payment']>;
  } = {},
): ReceiptInput {
  const { payment, ...rest } = overrides;
  return {
    language: 'de',
    location: LOCATION,
    receiptNumber: 'K1-261006-0012',
    orderNumber: '0042',
    tableLabel: '5',
    servedBy: 'Anna',
    timeZone: 'Europe/Zurich',
    issuedAt: '2026-10-06T18:30:00.000Z',
    order: { subtotalRappen: TOTAL, discountTotalRappen: rappen(0), totalRappen: TOTAL },
    lines: LINES,
    paidBeforeRappen: rappen(0),
    customer: null,
    customerNameFromRappen: DEFAULT_LOCATION_SETTINGS.receipts.customerNameFromRappen,
    ...rest,
    payment: {
      method: 'cash',
      amountRappen: TOTAL,
      tipRappen: rappen(0),
      roundingRappen: rappen(0),
      tenderedRappen: null,
      changeRappen: rappen(0),
      splitLabel: null,
      ...payment,
    },
  };
}

/** An order of a single banquet line of `total` Rp, to test the CHF 400 threshold. */
function banquet(total: number, customer: ReceiptInput['customer'] = null): ReceiptInput {
  const amount = rappen(total);
  return input({
    lines: [receiptLine('Bankett', total, 1, NORMAL)],
    order: { subtotalRappen: amount, discountTotalRappen: rappen(0), totalRappen: amount },
    payment: { amountRappen: amount },
    customer,
  });
}

function receiptErrorOf(fn: () => unknown): ReceiptError {
  try {
    fn();
  } catch (error) {
    if (error instanceof ReceiptError) return error;
    throw error;
  }
  throw new Error('Expected a ReceiptError, nothing was thrown');
}

describe('formatVatNumber (RN-08)', () => {
  it.each([
    ['de', 'CHE-123.456.789 MWST'],
    ['fr', 'CHE-123.456.789 TVA'],
    ['it', 'CHE-123.456.789 IVA'],
    ['en', 'CHE-123.456.789 MWST'],
  ] as const)('in %s prints %s', (language, printed) => {
    expect(formatVatNumber('CHE-123.456.789', language)).toBe(printed);
  });
});

describe('receiptTaxes (RF-D20, DEC-016, DEC-024)', () => {
  it('a single full payment prints the sums of the lines, highest rate first', () => {
    const taxes = receiptTaxes(LINES, TOTAL, TOTAL);
    expect(taxes).toEqual(summarizeByRate(LINES));
    expect(taxes).toEqual([
      { rateCode: 'normal', rateBp: 810, grossRappen: 1300, taxRappen: 97, netRappen: 1203 },
      { rateCode: 'reduced', rateBp: 260, grossRappen: 2450, taxRappen: 62, netRappen: 2388 },
    ]);
  });

  it('a partial payment splits its amount by the gross share of each rate', () => {
    // 20.00 over (13.00, 24.50) of 37.50 = 6.9333 and 13.0667 → floors 693 + 1306, and the
    // leftover rappen goes to the larger remainder (reduced). Tax extracted per rate:
    // 6.93 @ 8.1 % = 0.519 → 0.52; 13.07 @ 2.6 % = 0.331 → 0.33.
    expect(receiptTaxes(LINES, TOTAL, rappen(2000))).toEqual([
      { rateCode: 'normal', rateBp: 810, grossRappen: 693, taxRappen: 52, netRappen: 641 },
      { rateCode: 'reduced', rateBp: 260, grossRappen: 1307, taxRappen: 33, netRappen: 1274 },
    ]);
    // The second receipt (17.50) stands on its own: 6.0667 and 11.4333 → 607 and 1143.
    expect(receiptTaxes(LINES, TOTAL, rappen(1750))).toEqual([
      { rateCode: 'normal', rateBp: 810, grossRappen: 607, taxRappen: 45, netRappen: 562 },
      { rateCode: 'reduced', rateBp: 260, grossRappen: 1143, taxRappen: 29, netRappen: 1114 },
    ]);
  });

  it('the partial grosses always add up exactly to the amount paid', () => {
    for (let amount = 1; amount < TOTAL; amount += 13) {
      const taxes = receiptTaxes(LINES, TOTAL, rappen(amount));
      expect(taxes.reduce((sum, t) => sum + t.grossRappen, 0)).toBe(amount);
      for (const t of taxes) {
        expect(t.netRappen + t.taxRappen).toBe(t.grossRappen);
        expect(t.taxRappen).toBe(extractTax(t.grossRappen, t.rateBp));
      }
    }
  });

  it('drops the rates a partial payment does not reach', () => {
    // 0.01 of 37.50: both shares floor to 0; the rappen goes to the reduced rate.
    expect(receiptTaxes(LINES, TOTAL, rappen(1))).toEqual([
      { rateCode: 'reduced', rateBp: 260, grossRappen: 1, taxRappen: 0, netRappen: 1 },
    ]);
    // A rate whose lines total zero (a 100 % courtesy coffee) never gets a share.
    const courtesy = receiptLine('Kaffee', 450, 1, NORMAL, {
      discountRappen: rappen(450),
      lineTotalRappen: rappen(0),
      taxRappen: rappen(0),
    });
    const food = receiptLine('Berner Rösti', 2450, 1, REDUCED);
    expect(receiptTaxes([courtesy, food], rappen(2450), rappen(1000))).toEqual([
      { rateCode: 'reduced', rateBp: 260, grossRappen: 1000, taxRappen: 25, netRappen: 975 },
    ]);
  });

  it('has nothing to print without lines', () => {
    expect(receiptTaxes([], rappen(0), rappen(0))).toEqual([]);
    expect(receiptTaxes([], rappen(0), rappen(500))).toEqual([]);
  });
});

describe('refundTaxes (DEC-038)', () => {
  const paid = receiptTaxes(LINES, TOTAL, TOTAL);

  it('a full refund gives back exactly the MWST of the receipt', () => {
    expect(refundTaxes(paid, TOTAL, TOTAL)).toEqual(paid);
    // A partial payment refunded in full cancels its own receipt, not the order's split.
    const partial = receiptTaxes(LINES, TOTAL, rappen(2000));
    expect(refundTaxes(partial, rappen(2000), rappen(2000))).toEqual(partial);
  });

  it('a partial refund splits over the receipt rates and adds up to the amount', () => {
    // 10.00 over (13.00, 24.50): 3.4667 and 6.5333 → 347 and 653.
    expect(refundTaxes(paid, TOTAL, rappen(1000))).toEqual([
      { rateCode: 'normal', rateBp: 810, grossRappen: 347, taxRappen: 26, netRappen: 321 },
      { rateCode: 'reduced', rateBp: 260, grossRappen: 653, taxRappen: 17, netRappen: 636 },
    ]);
    for (let amount = 1; amount < TOTAL; amount += 29) {
      const taxes = refundTaxes(paid, TOTAL, rappen(amount));
      expect(taxes.reduce((sum, t) => sum + t.grossRappen, 0)).toBe(amount);
      for (const t of taxes) expect(t.netRappen + t.taxRappen).toBe(t.grossRappen);
    }
  });

  it('never touches the receipt it reads', () => {
    const copy = JSON.parse(JSON.stringify(paid)) as typeof paid;
    refundTaxes(paid, TOTAL, TOTAL)[0]!.grossRappen = rappen(1);
    expect(paid).toEqual(copy);
    expect(refundTaxes([], rappen(0), rappen(100))).toEqual([]);
  });
});

describe('buildReceipt (RF-D20, RN-08, RN-09, DEC-024)', () => {
  it('builds valid frozen content for a single full payment', () => {
    const content = buildReceipt(input());
    expect(receiptContentSchema.parse(content)).toEqual(content);
    expect(content).toMatchObject({
      version: 1,
      language: 'de',
      location: {
        name: 'Restaurant Demo Zürich',
        legalName: 'Demo Gastro AG',
        street: 'Bahnhofstrasse 1',
        postalCode: '8001',
        city: 'Zürich',
        vatNumber: 'CHE-123.456.789 MWST',
        header: null,
        footer: 'Bis bald!',
      },
      receiptNumber: 'K1-261006-0012',
      orderNumber: '0042',
      tableLabel: '5',
      issuedAt: '2026-10-06T18:30:00.000Z',
      timeZone: 'Europe/Zurich',
      servedBy: 'Anna',
      totals: { grossRappen: 3750, discountRappen: 0, totalRappen: 3750 },
      taxes: receiptTaxes(LINES, TOTAL, TOTAL),
      partial: null,
      customer: null,
    });
    expect(content.lines).toEqual([
      {
        name: 'Berner Rösti',
        variantName: null,
        quantity: 1,
        unitPriceRappen: 2450,
        modifiers: [],
        discountRappen: 0,
        totalRappen: 2450,
        taxRateCode: 'reduced',
        taxRateBp: 260,
      },
      {
        name: 'Bier',
        variantName: null,
        quantity: 2,
        unitPriceRappen: 650,
        modifiers: [],
        discountRappen: 0,
        totalRappen: 1300,
        taxRateCode: 'normal',
        taxRateBp: 810,
      },
    ]);
  });

  it('copies the modifiers instead of sharing them with the order', () => {
    const modifiers = [{ name: 'Spiegelei', priceDeltaRappen: rappen(250), quantity: 1 }];
    const withEgg = receiptLine('Berner Rösti', 2450, 1, REDUCED, {
      modifiers,
      lineTotalRappen: rappen(2700),
      taxRappen: extractTax(rappen(2700), 260),
    });
    const content = buildReceipt(
      input({
        lines: [withEgg],
        order: {
          subtotalRappen: rappen(2700),
          discountTotalRappen: rappen(0),
          totalRappen: rappen(2700),
        },
        payment: { amountRappen: rappen(2700) },
      }),
    );
    expect(content.lines[0]!.modifiers).toEqual(modifiers);
    expect(content.lines[0]!.modifiers[0]).not.toBe(modifiers[0]);
  });

  it('collects sale + tip + rounding (RN-06, RN-07)', () => {
    // 37.50 + 2.48 tip = 39.98 in cash → 40.00, rounding +0.02.
    const content = buildReceipt(
      input({
        payment: {
          tipRappen: rappen(248),
          roundingRappen: rappen(2),
          tenderedRappen: rappen(5000),
          changeRappen: rappen(1000),
        },
      }),
    );
    expect(content.payment).toEqual({
      method: 'cash',
      amountRappen: 3750,
      tipRappen: 248,
      roundingRappen: 2,
      collectedRappen: 4000,
      tenderedRappen: 5000,
      changeRappen: 1000,
      splitLabel: null,
    });
    // The tip carries no MWST: the taxes are those of the sale only.
    expect(content.taxes).toEqual(receiptTaxes(LINES, TOTAL, TOTAL));
  });

  describe('mandatory data (RN-08)', () => {
    it.each([null, ''])('refuses a location without UID (%j)', (vatUid) => {
      const error = receiptErrorOf(() =>
        buildReceipt(input({ location: { ...LOCATION, vatUid } })),
      );
      expect(error.code).toBe('VAT_UID_MISSING');
    });

    it('refuses a receipt without lines', () => {
      expect(receiptErrorOf(() => buildReceipt(input({ lines: [] }))).code).toBe(
        'NOTHING_TO_RECEIPT',
      );
    });

    it('requires the customer name from exactly CHF 400.00 (DEC-009)', () => {
      expect(DEFAULT_LOCATION_SETTINGS.receipts.customerNameFromRappen).toBe(40000);
      expect(receiptErrorOf(() => buildReceipt(banquet(40000))).code).toBe(
        'CUSTOMER_NAME_REQUIRED',
      );
      expect(
        receiptErrorOf(() => buildReceipt(banquet(40000, { name: '   ', address: null }))).code,
      ).toBe('CUSTOMER_NAME_REQUIRED');
    });

    it('does not require it at CHF 399.99', () => {
      expect(buildReceipt(banquet(39999)).customer).toBeNull();
    });

    it('stores the customer trimmed; the address is optional', () => {
      const withAddress = buildReceipt(
        banquet(40000, { name: '  Muster AG  ', address: '  Seestrasse 5, 8002 Zürich ' }),
      );
      expect(withAddress.customer).toEqual({
        name: 'Muster AG',
        address: 'Seestrasse 5, 8002 Zürich',
      });
      expect(buildReceipt(banquet(40000, { name: 'Muster AG', address: null })).customer).toEqual({
        name: 'Muster AG',
        address: null,
      });
      expect(buildReceipt(banquet(40000, { name: 'Muster AG', address: '   ' })).customer).toEqual({
        name: 'Muster AG',
        address: null,
      });
    });

    it('keeps a customer name given below the threshold', () => {
      expect(
        buildReceipt(input({ customer: { name: 'Frau Meier', address: null } })).customer,
      ).toEqual({ name: 'Frau Meier', address: null });
    });

    it('follows the threshold of the location settings', () => {
      const strict = input({ customerNameFromRappen: 3750 });
      expect(receiptErrorOf(() => buildReceipt(strict)).code).toBe('CUSTOMER_NAME_REQUIRED');
      expect(() => buildReceipt(input({ customerNameFromRappen: 3751 }))).not.toThrow();
    });
  });

  describe('split and partial payments (RF-C12, RF-D02)', () => {
    it('the first of two payments shows the balance left', () => {
      const content = buildReceipt(
        input({ payment: { amountRappen: rappen(2000), splitLabel: '1/2' } }),
      );
      expect(content.partial).toEqual({ paidBeforeRappen: 0, balanceAfterRappen: 1750 });
      expect(content.taxes).toEqual(receiptTaxes(LINES, TOTAL, rappen(2000)));
      expect(content.payment.splitLabel).toBe('1/2');
      expect(receiptContentSchema.parse(content)).toEqual(content);
    });

    it('the last payment shows what was paid before and a zero balance', () => {
      const content = buildReceipt(
        input({ paidBeforeRappen: rappen(2000), payment: { amountRappen: rappen(1750) } }),
      );
      expect(content.partial).toEqual({ paidBeforeRappen: 2000, balanceAfterRappen: 0 });
      expect(content.taxes.map((t) => t.grossRappen)).toEqual([607, 1143]);
    });

    it('the totals stay those of the whole order', () => {
      const content = buildReceipt(input({ payment: { amountRappen: rappen(2000) } }));
      expect(content.totals.totalRappen).toBe(3750);
    });
  });

  describe('labels in the receipt language (RF-D23, RN-10)', () => {
    it.each([
      ['de', 'Bar', 'Total', 'CHE-123.456.789 MWST'],
      ['fr', 'Espèces', 'Total', 'CHE-123.456.789 TVA'],
      ['it', 'Contanti', 'Totale', 'CHE-123.456.789 IVA'],
      ['en', 'Cash', 'Total', 'CHE-123.456.789 MWST'],
    ] as const)('%s: cash is "%s"', (language, cash, total, vatNumber) => {
      const content = buildReceipt(input({ language }));
      expect(content.language).toBe(language);
      expect(content.labels['methods.cash']).toBe(cash);
      expect(content.labels.total).toBe(total);
      expect(content.location.vatNumber).toBe(vatNumber);
    });

    it('stores the labels flat, one entry per payment method', () => {
      for (const language of CONTENT_LANGUAGES) {
        const { labels } = buildReceipt(input({ language }));
        expect(labels.methods).toBeUndefined();
        expect(
          Object.keys(labels)
            .filter((key) => key.startsWith('methods.'))
            .sort(),
        ).toEqual([
          'methods.card',
          'methods.cash',
          'methods.online',
          'methods.twint',
          'methods.voucher',
        ]);
        expect(Object.values(labels).every((value) => typeof value === 'string')).toBe(true);
      }
    });
  });
});
