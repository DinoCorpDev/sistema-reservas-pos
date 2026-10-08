import { describe, expect, it } from 'vitest';
import { buildReceipt } from '../receipts/build';
import type { ReceiptContent } from '../receipts/content';
import { renderReceiptText } from '../receipts/render';
import { rappen } from '../shared/money';
import {
  columnsAt,
  columnsFor,
  drawerDocument,
  receiptDocument,
  wrapText,
  wrapped,
} from './document';

describe('print documents (DEC-031)', () => {
  it('columns per paper width and size', () => {
    expect(columnsFor(80)).toBe(48);
    expect(columnsFor(58)).toBe(32);
    expect(columnsAt(48, 'large')).toBe(24);
    expect(columnsAt(48, 'tall')).toBe(48);
  });

  it('wraps on words, cuts words longer than the line, keeps empty paragraphs', () => {
    expect(wrapText('Ohne Zwiebeln bitte', 8)).toEqual(['Ohne', 'Zwiebeln', 'bitte']);
    expect(wrapText('Donaudampfschifffahrt', 8)).toEqual(['Donaudam', 'pfschiff', 'fahrt']);
    expect(wrapText('a\n\nb', 10)).toEqual(['a', '', 'b']);
    // The indent takes room from the line: 6 columns − 2 = 4 per line.
    expect(wrapped('Zwei Wörter', 6, { bold: true }, '  ')).toEqual([
      { bold: true, text: '  Zwei' },
      { bold: true, text: '  Wört' },
      { bold: true, text: '  er' },
    ]);
  });

  it('a receipt prints the same frozen lines as the screen, with or without the drawer', () => {
    const content: ReceiptContent = buildReceipt({
      language: 'de',
      location: {
        name: 'Restaurant Demo Zürich',
        legalName: null,
        street: 'Bahnhofstrasse 1',
        postalCode: '8001',
        city: 'Zürich',
        vatUid: 'CHE-123.456.788',
        header: null,
        footer: null,
      },
      receiptNumber: 'K1-261007-0001',
      orderNumber: '0001',
      tableLabel: '5',
      servedBy: 'Anna',
      timeZone: 'Europe/Zurich',
      issuedAt: '2026-10-07T18:30:00.000Z',
      order: {
        subtotalRappen: rappen(2450),
        discountTotalRappen: rappen(0),
        totalRappen: rappen(2450),
      },
      lines: [
        {
          name: 'Berner Rösti',
          variantName: null,
          quantity: 1,
          unitPriceRappen: rappen(2450),
          modifiers: [],
          discountRappen: rappen(0),
          lineTotalRappen: rappen(2450),
          taxRappen: rappen(183),
          taxRateCode: 'normal',
          taxRateBp: 810,
        },
      ],
      payment: {
        method: 'cash',
        amountRappen: rappen(2450),
        tipRappen: rappen(0),
        roundingRappen: rappen(0),
        tenderedRappen: rappen(5000),
        changeRappen: rappen(2550),
        splitLabel: null,
      },
      paidBeforeRappen: rappen(0),
      customer: null,
      customerNameFromRappen: 40000,
    });
    const doc = receiptDocument(content, { width: 48, openDrawer: true });
    expect(doc.lines.map((l) => l.text)).toEqual(renderReceiptText(content, { width: 48 }));
    expect(doc).toMatchObject({ cut: true, openDrawer: true });
    const copy = receiptDocument(content, { width: 48, copyAt: '2026-10-07T18:45:00.000Z' });
    expect(copy.lines.at(-1)!.text).toContain('KOPIE');
    expect(copy.openDrawer).toBe(false);
  });

  it('a drawer kick prints nothing and does not cut', () => {
    expect(drawerDocument()).toEqual({ lines: [], cut: false, openDrawer: true });
  });
});
