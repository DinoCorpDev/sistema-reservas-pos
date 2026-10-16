import { describe, expect, it } from 'vitest';
import { SAMPLE_SHIFT_REPORT } from '../orders/test-kit';
import { PAPER_COLUMNS } from '../printing/document';
import { SHIFT_REPORT_LABELS, shiftReportDocument } from './report-print';

describe('shiftReportDocument (RF-D15)', () => {
  const report = {
    ...SAMPLE_SHIFT_REPORT,
    payments: [
      {
        method: 'cash' as const,
        count: 3,
        amountRappen: 7000,
        tipRappen: 100,
        roundingRappen: -2,
        collectedRappen: 7098,
      },
      {
        method: 'card' as const,
        count: 2,
        amountRappen: 5000,
        tipRappen: 300,
        roundingRappen: 0,
        collectedRappen: 5300,
      },
    ],
    movements: [{ kind: 'expense' as const, count: 1, amountRappen: -1250 }],
    cash: {
      openingFloatRappen: 20000,
      collectedRappen: 7098,
      paidOutRappen: 0,
      movementsRappen: -1250,
      expectedRappen: 25848,
    },
  };

  it.each([58, 80] as const)(
    'fits %i mm paper and shows expected, counted and difference',
    (paper) => {
      const width = PAPER_COLUMNS[paper];
      const doc = shiftReportDocument(
        report,
        {
          countedRappen: 25800,
          expectedRappen: 25848,
          comment: 'Münze fehlt beim Zählen nach dem Service',
        },
        { width, labels: SHIFT_REPORT_LABELS.de },
      );
      const text = doc.lines.map((l) => l.text);
      expect(doc.cut).toBe(true);
      expect(doc.openDrawer).toBe(false);
      for (const line of doc.lines.filter((l) => l.size !== 'tall')) {
        expect(line.text.length).toBeLessThanOrEqual(width);
      }
      expect(text.join('\n')).toContain('SCHICHTABSCHLUSS');
      expect(text.find((l) => l.startsWith('Bar (3)'))).toMatch(/70\.98$/);
      expect(text.find((l) => l.startsWith('Soll-Bestand'))).toMatch(/258\.48$/);
      expect(text.find((l) => l.startsWith('Gezählt'))).toMatch(/258\.00$/);
      expect(text.find((l) => l.startsWith('Differenz'))).toMatch(/-0\.48$/);
      expect(text.join(' ')).toContain('Münze fehlt');
    },
  );

  it('has its labels in the five printing languages (DEC-046)', () => {
    expect(Object.keys(SHIFT_REPORT_LABELS).sort()).toEqual(['de', 'en', 'es', 'fr', 'it']);
  });
});
