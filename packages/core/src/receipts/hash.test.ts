import { describe, expect, it } from 'vitest';
import { rappen } from '../shared/money';
import { extractTax } from '../tax/calculation';
import { buildReceipt } from './build';
import type { ReceiptContent } from './content';
import { canonicalJson, contentHash, receiptContentHash } from './hash';

function sampleContent(): ReceiptContent {
  const total = rappen(2450);
  return buildReceipt({
    language: 'de',
    location: {
      name: 'Restaurant Demo Zürich',
      legalName: null,
      street: 'Bahnhofstrasse 1',
      postalCode: '8001',
      city: 'Zürich',
      vatUid: 'CHE-123.456.789',
      header: null,
      footer: null,
    },
    receiptNumber: 'K1-261006-0012',
    orderNumber: '0042',
    tableLabel: '5',
    servedBy: 'Anna',
    timeZone: 'Europe/Zurich',
    issuedAt: '2026-10-06T18:30:00.000Z',
    order: { subtotalRappen: total, discountTotalRappen: rappen(0), totalRappen: total },
    lines: [
      {
        name: 'Berner Rösti',
        variantName: null,
        quantity: 1,
        unitPriceRappen: total,
        modifiers: [{ name: 'Spiegelei', priceDeltaRappen: rappen(0), quantity: 1 }],
        discountRappen: rappen(0),
        lineTotalRappen: total,
        taxRappen: extractTax(total, 810),
        taxRateCode: 'normal',
        taxRateBp: 810,
      },
    ],
    payment: {
      method: 'card',
      amountRappen: total,
      tipRappen: rappen(0),
      roundingRappen: rappen(0),
      tenderedRappen: null,
      changeRappen: rappen(0),
      splitLabel: null,
    },
    paidBeforeRappen: rappen(0),
    customer: null,
    customerNameFromRappen: 40000,
  });
}

/** Deep copy with the keys of every object in reverse insertion order. */
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, inner]) => [key, reverseKeys(inner)]),
    );
  }
  return value;
}

describe('canonicalJson', () => {
  it('sorts object keys at every level, inside arrays too', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[3,{"y":2,"z":1}]},"b":1}',
    );
  });

  it('keeps the order of array elements', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });

  it('drops undefined properties like JSON.stringify', () => {
    expect(canonicalJson({ b: undefined, a: 1, c: { d: undefined } })).toBe('{"a":1,"c":{}}');
  });

  it('serializes primitives and escapes strings like JSON.stringify', () => {
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(true)).toBe('true');
    expect(canonicalJson(-42)).toBe('-42');
    expect(canonicalJson('Zürich "Altstadt"')).toBe('"Zürich \\"Altstadt\\""');
    expect(canonicalJson({ 'a"b': 'x\ny' })).toBe('{"a\\"b":"x\\ny"}');
  });

  it('is the same text for the same content, whatever the key order', () => {
    const content = sampleContent();
    expect(canonicalJson(reverseKeys(content))).toBe(canonicalJson(content));
    expect(JSON.parse(canonicalJson(content))).toEqual(content);
  });

  it('renders undefined array entries as null, like JSON.stringify', () => {
    expect(canonicalJson([1, undefined, 2])).toBe('[1,null,2]');
  });
});

describe('receiptContentHash (RN-10)', () => {
  it('is the SHA-256 of the canonical UTF-8 text', async () => {
    expect(await receiptContentHash({} as ReceiptContent)).toBe(
      '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
    );
    // sha256('{"city":"Zürich","name":"Demo"}'), with "ü" as two UTF-8 bytes.
    const unordered = { name: 'Demo', city: 'Zürich' } as unknown as ReceiptContent;
    expect(await receiptContentHash(unordered)).toBe(
      '3c1fe6cd31ec679a2271e9a0ddebbc3da760746482af90becab3595e75a4a5c3',
    );
  });

  it('is 64 lowercase hex characters', async () => {
    expect(await receiptContentHash(sampleContent())).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable for equal content built with a different key order', async () => {
    const content = sampleContent();
    const reordered = reverseKeys(content) as ReceiptContent;
    expect(Object.keys(reordered)[0]).not.toBe(Object.keys(content)[0]);
    expect(await receiptContentHash(reordered)).toBe(await receiptContentHash(content));
    expect(await receiptContentHash(sampleContent())).toBe(await receiptContentHash(content));
  });

  it('is the same hash as contentHash, which also seals closings (RN-10)', async () => {
    const content = sampleContent();
    expect(await contentHash(content)).toBe(await receiptContentHash(content));
    expect(await contentHash({ closingNumber: 1, totals: { a: 1 } })).toBe(
      await contentHash({ totals: { a: 1 }, closingNumber: 1 }),
    );
  });

  it('changes when anything printed changes, even by one rappen', async () => {
    const content = sampleContent();
    const original = await receiptContentHash(content);
    const otherNumber = { ...content, receiptNumber: 'K1-261006-0013' };
    const otherAmount = {
      ...content,
      payment: { ...content.payment, amountRappen: content.payment.amountRappen + 1 },
    };
    const otherModifier = {
      ...content,
      lines: [{ ...content.lines[0]!, modifiers: [] }],
    };
    for (const changed of [otherNumber, otherAmount, otherModifier]) {
      expect(await receiptContentHash(changed)).not.toBe(original);
    }
  });
});
