import { describe, expect, it, vi } from 'vitest';
import { CONTENT_LANGUAGES } from '../shared/languages';
import { rappen } from '../shared/money';
import { extractTax } from '../tax/calculation';
import type { TaxRateCode } from '../tax/constants';
import { buildReceipt, formatVatNumber, type ReceiptLineInput } from './build';
import type { ReceiptContent } from './content';
import { formatRate, RECEIPT_COLUMNS, renderReceiptText } from './render';

type ReceiptInput = Parameters<typeof buildReceipt>[0];

function receiptLine(
  name: string,
  unitPriceRappen: number,
  quantity: number,
  rate: { code: TaxRateCode; bp: number },
  fields: { discountRappen?: number; modifiers?: ReceiptLineInput['modifiers'] } = {},
): ReceiptLineInput {
  const modifiers = fields.modifiers ?? [];
  const perUnit =
    unitPriceRappen + modifiers.reduce((s, m) => s + m.priceDeltaRappen * m.quantity, 0);
  const discount = fields.discountRappen ?? 0;
  const total = rappen(perUnit * quantity - discount);
  return {
    name,
    variantName: null,
    quantity,
    unitPriceRappen: rappen(unitPriceRappen),
    modifiers,
    discountRappen: rappen(discount),
    lineTotalRappen: total,
    taxRappen: extractTax(total, rate.bp),
    taxRateCode: rate.code,
    taxRateBp: rate.bp,
  };
}

const NORMAL = { code: 'normal', bp: 810 } as const;
const REDUCED = { code: 'reduced', bp: 260 } as const;

/**
 * Takeaway: Rösti 24.50 + Spiegelei 2.50 = 27.00 @ 2.6 % (MWST 0.68), 2 × Bier 6.50 = 13.00 with
 * 10 % off = 11.70 @ 8.1 % (MWST 0.88). Subtotal 40.00, discount 1.30, total 38.70.
 */
const LINES = [
  receiptLine('Berner Rösti', 2450, 1, REDUCED, {
    modifiers: [{ name: 'Spiegelei', priceDeltaRappen: rappen(250), quantity: 1 }],
  }),
  receiptLine('Bier', 650, 2, NORMAL, { discountRappen: 130 }),
];

function content(
  overrides: Partial<Omit<ReceiptInput, 'payment'>> & {
    payment?: Partial<ReceiptInput['payment']>;
  } = {},
): ReceiptContent {
  const { payment, ...rest } = overrides;
  const lines = rest.lines ?? LINES;
  const gross = lines.reduce((s, l) => s + l.lineTotalRappen + l.discountRappen, 0);
  const discount = lines.reduce((s, l) => s + l.discountRappen, 0);
  const total = rappen(gross - discount);
  return buildReceipt({
    language: 'de',
    location: {
      name: 'Restaurant Demo Zürich',
      legalName: 'Demo Gastro AG',
      street: 'Bahnhofstrasse 1',
      postalCode: '8001',
      city: 'Zürich',
      vatUid: 'CHE-123.456.789',
      header: null,
      footer: 'Bis bald!',
    },
    receiptNumber: 'K1-261006-0012',
    orderNumber: '0042',
    tableLabel: '5',
    servedBy: 'Anna',
    timeZone: 'Europe/Zurich',
    issuedAt: '2026-10-06T18:30:00.000Z', // 20:30 in Zürich
    order: {
      subtotalRappen: rappen(gross),
      discountTotalRappen: rappen(discount),
      totalRappen: total,
    },
    lines,
    paidBeforeRappen: rappen(0),
    customer: null,
    customerNameFromRappen: 40000,
    ...rest,
    payment: {
      method: 'cash',
      amountRappen: total,
      tipRappen: rappen(0),
      roundingRappen: rappen(0),
      tenderedRappen: rappen(5000),
      changeRappen: rappen(5000 - total),
      splitLabel: null,
      ...payment,
    },
  });
}

const lineStarting = (lines: string[], prefix: string) => lines.find((l) => l.startsWith(prefix));

function expectWithinWidth(lines: string[], width = RECEIPT_COLUMNS) {
  const tooLong = lines.filter((line) => line.length > width);
  expect(tooLong).toEqual([]);
}

/** Turns an endless wrapping loop into an error, so a hang cannot freeze the test run. */
function withLoopGuard<T>(fn: () => T): T {
  const trimEnd = String.prototype.trimEnd;
  let calls = 0;
  const spy = vi.spyOn(String.prototype, 'trimEnd').mockImplementation(function (this: string) {
    calls += 1;
    if (calls > 100_000) throw new Error('renderReceiptText does not terminate');
    return trimEnd.call(this);
  });
  try {
    return fn();
  } finally {
    spy.mockRestore();
  }
}

describe('formatRate', () => {
  it.each([
    [810, '8.1%'],
    [260, '2.6%'],
    [380, '3.8%'],
    [770, '7.7%'],
    [1000, '10%'],
    [1050, '10.5%'],
    [5, '0.05%'],
    [0, '0%'],
  ])('%i bp → %s', (bp, text) => {
    expect(formatRate(bp)).toBe(text);
  });
});

describe('renderReceiptText (80 mm, 42 columns)', () => {
  const lines = renderReceiptText(content());

  it('never exceeds 42 columns', () => {
    expect(RECEIPT_COLUMNS).toBe(42);
    expectWithinWidth(lines);
  });

  it('prints the location with its UID and MWST suffix (RN-08)', () => {
    const trimmed = lines.map((l) => l.trim());
    for (const text of [
      'Restaurant Demo Zürich',
      'Demo Gastro AG',
      'Bahnhofstrasse 1',
      '8001 Zürich',
      'CHE-123.456.789 MWST',
    ]) {
      expect(trimmed).toContain(text);
    }
  });

  it('prints receipt number, order, table, local date and waiter', () => {
    expect(lineStarting(lines, 'Quittung')).toMatch(/^Quittung\s+Beleg-Nr\. K1-261006-0012$/);
    expect(lineStarting(lines, 'Bestellung')).toMatch(/^Bestellung 0042\s+Tisch 5$/);
    expect(lines).toContain('Datum 06.10.2026 20:30');
    expect(lines).toContain('Bedient von Anna');
  });

  it('prints each line with its amount right-aligned, then modifiers and discount', () => {
    const rosti = lineStarting(lines, '1 x Berner Rösti')!;
    expect(rosti).toMatch(/\s27\.00$/);
    expect(rosti).toHaveLength(42);
    expect(lines).toContain('  + Spiegelei');
    const beer = lines.indexOf(lineStarting(lines, '2 x Bier')!);
    expect(lines[beer]).toMatch(/\s13\.00$/);
    expect(lines[beer + 1]).toMatch(/^ {2}Rabatt\s+-1\.30$/);
  });

  it('prints subtotal, discount and the total in CHF', () => {
    expect(lineStarting(lines, 'Zwischensumme')).toMatch(/\s40\.00$/);
    expect(lines).toContainEqual(expect.stringMatching(/^Rabatt\s+-1\.30$/));
    const total = lineStarting(lines, 'TOTAL CHF')!;
    expect(total).toMatch(/^TOTAL CHF\s+38\.70$/);
    expect(total).toHaveLength(42);
  });

  it('prints the MWST per rate: rate, gross, tax, net', () => {
    expect(lineStarting(lines, 'MWST ')).toMatch(/^MWST\s+Brutto\s+MWST\s+Netto$/);
    expect(lineStarting(lines, '8.1%')).toMatch(/^8\.1%\s+11\.70\s+0\.88\s+10\.82$/);
    expect(lineStarting(lines, '2.6%')).toMatch(/^2\.6%\s+27\.00\s+0\.68\s+26\.32$/);
    expect(lineStarting(lines, '8.1%')).toHaveLength(42);
  });

  it('prints the payment method label, tendered cash and change', () => {
    expect(lineStarting(lines, 'Bezahlt mit Bar')).toMatch(/\s38\.70$/);
    expect(lineStarting(lines, 'Gegeben')).toMatch(/\s50\.00$/);
    expect(lineStarting(lines, 'Rückgeld')).toMatch(/\s11\.30$/);
    expect(lineStarting(lines, 'Trinkgeld')).toBeUndefined();
    expect(lineStarting(lines, 'Rundung')).toBeUndefined();
  });

  it('ends with the footer and the thank-you line, without a copy mark', () => {
    expect(lines.map((l) => l.trim()).slice(-2)).toEqual([
      'Bis bald!',
      'Vielen Dank für Ihren Besuch',
    ]);
    expect(lines.some((l) => l.includes('KOPIE'))).toBe(false);
  });

  it('a training receipt says it is not valid, first and last (RF-F22)', () => {
    const training = renderReceiptText(content({ training: true }));
    expect(training[0]!.trim()).toBe('*** ÜBUNG — KEIN GÜLTIGER BELEG ***');
    expect(training.at(-1)!.trim()).toBe('*** ÜBUNG — KEIN GÜLTIGER BELEG ***');
    expect(training.slice(1, -2)).toEqual(lines);
    expectWithinWidth(training);
    expect(lines.some((l) => l.includes('ÜBUNG'))).toBe(false);
    const italian = renderReceiptText(content({ training: true, language: 'it' }), { width: 32 });
    expectWithinWidth(italian, 32);
    expect(italian.join(' ')).toContain('ESERCITAZIONE');
  });

  it('marks a reprint as a copy with its local time (RF-D24)', () => {
    const copy = renderReceiptText(content(), { copyAt: '2026-10-07T07:05:00.000Z' });
    expect(copy.slice(0, -2)).toEqual(lines);
    expect(copy.at(-2)).toBe('');
    expect(copy.at(-1)!.trim()).toBe('*** KOPIE 07.10.2026 09:05 ***');
  });

  it('prints tip and rounding when there are any (RN-06, RN-07)', () => {
    // 38.70 + 2.28 tip = 40.98 in cash → 41.00, rounding +0.02.
    const text = renderReceiptText(
      content({
        payment: { tipRappen: rappen(228), roundingRappen: rappen(2), changeRappen: rappen(900) },
      }),
    );
    expect(lineStarting(text, 'Trinkgeld')).toMatch(/\s2\.28$/);
    expect(lineStarting(text, 'Rundung')).toMatch(/\s0\.02$/);
    expectWithinWidth(text);
  });

  it('prints a partial payment with what was paid before and the balance', () => {
    const text = renderReceiptText(
      content({
        payment: {
          method: 'card',
          amountRappen: rappen(2000),
          tenderedRappen: null,
          changeRappen: rappen(0),
          splitLabel: '1/2',
        },
      }),
    );
    expect(lineStarting(text, 'Bezahlt mit Karte (1/2)')).toMatch(/\s20\.00$/);
    expect(lineStarting(text, 'Gegeben')).toBeUndefined();
    expect(text).toContain('Teilzahlung');
    expect(lineStarting(text, 'Bereits bezahlt')).toMatch(/\s0\.00$/);
    expect(lineStarting(text, 'Offener Betrag')).toMatch(/\s18\.70$/);
  });

  it('prints the customer from CHF 400 (RN-08)', () => {
    const banquet = [receiptLine('Bankett', 45000, 1, NORMAL)];
    const text = renderReceiptText(
      content({
        lines: banquet,
        customer: { name: 'Muster AG', address: 'Seestrasse 5, 8002 Zürich' },
        payment: { tenderedRappen: null, changeRappen: rappen(0) },
      }),
    );
    expect(text).toContain('Kunde: Muster AG');
    expect(text).toContain('Seestrasse 5, 8002 Zürich');
    expect(lineStarting(text, 'TOTAL CHF')).toMatch(/\s450\.00$/);
  });

  it('wraps a long product name and keeps the amount right-aligned on its last line', () => {
    const name = 'Zürcher Geschnetzeltes mit Butterrösti und Rahmsauce nach Art des Hauses';
    const text = renderReceiptText(content({ lines: [receiptLine(name, 3850, 1, NORMAL)] }));
    expectWithinWidth(text);
    const first = text.findIndex((l) => l.startsWith('1 x Zürcher'));
    const last = text.findIndex((l, i) => i >= first && /\s38\.50$/.test(l));
    expect(last).toBeGreaterThan(first);
    expect(text[last]).toHaveLength(42);
    // The wrapped name reads the same when joined back together.
    const wrapped = text
      .slice(first, last + 1)
      .map((l, i, all) => (i === all.length - 1 ? l.replace(/\s+38\.50$/, '') : l));
    expect(wrapped.join(' ')).toBe(`1 x ${name}`);
  });

  it('cuts a single word longer than the line', () => {
    const name = 'Donaudampfschifffahrtsgesellschaftskapitänsmütze';
    const text = renderReceiptText(content({ lines: [receiptLine(name, 1200, 1, REDUCED)] }));
    expectWithinWidth(text);
    expect(text.find((l) => l.includes('mütze'))).toMatch(/\s12\.00$/);
  });

  it('wraps long header and footer texts and centers them', () => {
    const footer =
      'Wir freuen uns auf Ihren nächsten Besuch. Montag bis Samstag 11:00 bis 23:00 Uhr';
    const text = renderReceiptText(
      content({
        location: {
          name: 'Restaurant Demo Zürich',
          legalName: null,
          street: 'Bahnhofstrasse 1',
          postalCode: '8001',
          city: 'Zürich',
          vatUid: 'CHE-123.456.789',
          header: 'Seit 1898 im Herzen der Stadt\nTäglich frische Zutaten aus der Region',
          footer,
        },
      }),
    );
    expectWithinWidth(text);
    expect(text.map((l) => l.trim())).toContain('Seit 1898 im Herzen der Stadt');
    expect(text.some((l) => l.startsWith(' ') && l.includes('Montag'))).toBe(true);
  });

  it.each(CONTENT_LANGUAGES)('stays within 42 columns in %s', (language) => {
    const text = renderReceiptText(
      content({
        language,
        customer: { name: 'Muster AG', address: 'Seestrasse 5, 8002 Zürich' },
        payment: {
          amountRappen: rappen(2000),
          tipRappen: rappen(300),
          tenderedRappen: rappen(5000),
          changeRappen: rappen(2700),
          splitLabel: '1/2',
        },
      }),
      { copyAt: '2026-10-06T19:00:00.000Z' },
    );
    expectWithinWidth(text);
  });

  it('uses the labels of the receipt language', () => {
    const french = renderReceiptText(content({ language: 'fr' }));
    expect(lineStarting(french, 'TOTAL CHF')).toMatch(/\s38\.70$/);
    expect(lineStarting(french, 'Payé par Espèces')).toMatch(/\s38\.70$/);
    expect(french.map((l) => l.trim())).toContain('CHE-123.456.789 TVA');
    const italian = renderReceiptText(content({ language: 'it' }));
    expect(lineStarting(italian, 'TOTALE CHF')).toMatch(/\s38\.70$/);
    expect(lineStarting(italian, 'Pagato con Contanti')).toBeDefined();
  });

  // Layout edge cases found while testing (they used to overflow or hang).

  it('wraps a long waiter name instead of overflowing the paper', () => {
    // "Bedient von " (12) + 38 characters = 50 columns; the schema allows names up to 100.
    const text = renderReceiptText(content({ servedBy: 'Maria-Theresia von Gunten-Schaffhauser' }));
    expectWithinWidth(text);
  });

  it('terminates with a long table label (35+ characters, the schema allows 40)', () => {
    // "Tisch " + 35 characters leaves no room on the order line: it goes on its own line.
    const text = withLoopGuard(() =>
      renderReceiptText(content({ tableLabel: 'Terrasse Seeseite hinten links 12ab' })),
    );
    expectWithinWidth(text);
    expect(text.some((l) => l.includes('Bestellung 0042'))).toBe(true);
    expect(text.some((l) => l.trim().endsWith('12ab'))).toBe(true);
  });

  it('fits a narrower paper width (58 mm, 32 columns)', () => {
    expectWithinWidth(renderReceiptText(content(), { width: 32 }), 32);
  });
});

describe('a receipt in Colombia (DEC-047)', () => {
  const cop = (overrides: Parameters<typeof content>[0] = {}) =>
    content({
      language: 'es',
      currency: 'COP',
      location: {
        name: 'Café Demo Bogotá',
        legalName: 'Café Demo SAS',
        street: 'Calle 85 # 12-30',
        postalCode: '110221',
        city: 'Bogotá',
        vatUid: '8001972684',
        header: null,
        footer: null,
        country: 'CO',
        taxLabel: 'INC',
      },
      lines: [receiptLine('Capuchino', 800_000, 2, NORMAL)],
      // Colombia's default (DEC-047): the name is asked from $1.000.000.
      customerNameFromRappen: 100_000_000,
      payment: {
        amountRappen: rappen(1_600_000),
        tenderedRappen: rappen(2_000_000),
        changeRappen: rappen(400_000),
      },
      ...overrides,
    });

  it('prints the NIT, pesos and the INC instead of the Swiss UID, CHF and MWST', () => {
    const receipt = cop();
    expect(receipt.currency).toBe('COP');
    expect(receipt.location.vatNumber).toBe('NIT 800.197.268-4');
    expect(receipt.labels.vat).toBe('INC');
    const text = renderReceiptText(receipt).join('\n');
    expect(text).toContain('NIT 800.197.268-4');
    expect(text).toMatch(/TOTAL COP\s+16\.000/);
    expect(text).not.toContain('CHF');
    expect(text).not.toContain('MWST');
  });
});

describe('the UID on Swiss receipts (RN-08)', () => {
  it('prints the suffix once, also when the UID is stored with it', () => {
    expect(formatVatNumber('CHE-123.456.788 MWST', 'de')).toBe('CHE-123.456.788 MWST');
    expect(formatVatNumber('CHE-123.456.788 MWST', 'fr')).toBe('CHE-123.456.788 TVA');
    expect(formatVatNumber('CHE-123.456.788', 'it')).toBe('CHE-123.456.788 IVA');
  });

  it('a CHF receipt carries no currency field, as before (same content and hash)', () => {
    expect(content()).not.toHaveProperty('currency');
  });
});
