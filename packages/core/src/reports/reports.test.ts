import { describe, expect, it } from 'vitest';
import { adjustmentsReport } from './adjustments';
import { itemSalesReport } from './items';
import {
  daysInPeriod,
  periodKey,
  previousPeriod,
  REPORT_MAX_DAYS,
  reportPeriodSchema,
  vatReportQuerySchema,
} from './period';
import { durationStats, kitchenTimesReport, tableTimesReport } from './times';

describe('report period', () => {
  it('counts whole days, both ends included', () => {
    expect(daysInPeriod('2026-10-01', '2026-10-31')).toBe(31);
    expect(daysInPeriod('2026-10-09', '2026-10-09')).toBe(1);
    // Across the DST change.
    expect(daysInPeriod('2026-10-24', '2026-10-26')).toBe(3);
  });

  it('the previous period has the same length, right before', () => {
    expect(previousPeriod({ from: '2026-10-01', to: '2026-10-31' })).toEqual({
      from: '2026-08-31',
      to: '2026-09-30',
    });
    expect(previousPeriod({ from: '2026-10-09', to: '2026-10-09' })).toEqual({
      from: '2026-10-08',
      to: '2026-10-08',
    });
  });

  it('refuses a period backwards or longer than a year', () => {
    expect(reportPeriodSchema.safeParse({ from: '2026-10-09', to: '2026-10-01' }).success).toBe(
      false,
    );
    expect(reportPeriodSchema.safeParse({ from: '2025-01-01', to: '2026-01-02' }).success).toBe(
      false,
    );
    expect(daysInPeriod('2025-01-01', '2026-01-01')).toBe(REPORT_MAX_DAYS);
    expect(reportPeriodSchema.safeParse({ from: '2025-01-01', to: '2026-01-01' }).success).toBe(
      true,
    );
    expect(vatReportQuerySchema.parse({ from: '2026-01-01', to: '2026-06-30' })).toMatchObject({
      granularity: 'month',
    });
  });

  it('MWST buckets: day, month, quarter, half-year, year', () => {
    expect(periodKey('2026-08-15', 'day')).toBe('2026-08-15');
    expect(periodKey('2026-08-15', 'month')).toBe('2026-08');
    expect(periodKey('2026-08-15', 'quarter')).toBe('2026-Q3');
    expect(periodKey('2026-03-31', 'quarter')).toBe('2026-Q1');
    expect(periodKey('2026-06-30', 'half')).toBe('2026-H1');
    expect(periodKey('2026-07-01', 'half')).toBe('2026-H2');
    expect(periodKey('2026-07-01', 'year')).toBe('2026');
  });
});

describe('sales by category and product (RF-F01)', () => {
  it('groups the lines; both views add up to the total', () => {
    const report = itemSalesReport([
      {
        productId: 'p1',
        productName: 'Paella',
        categoryId: 'c1',
        categoryName: 'Reis',
        quantity: 2,
        lineTotalRappen: 5_800,
      },
      {
        productId: 'p2',
        productName: 'Bier',
        categoryId: 'c2',
        categoryName: 'Biere',
        quantity: 3,
        lineTotalRappen: 2_100,
      },
      {
        productId: 'p1',
        productName: 'Paella',
        categoryId: 'c1',
        categoryName: 'Reis',
        quantity: 1,
        lineTotalRappen: 2_610,
      },
      {
        productId: null,
        productName: 'Spezial',
        categoryId: null,
        categoryName: null,
        quantity: 1,
        lineTotalRappen: 500,
      },
    ]);
    expect(report).toMatchObject({ salesRappen: 11_010, quantity: 7 });
    expect(report.byProduct[0]).toMatchObject({ id: 'p1', quantity: 3, salesRappen: 8_410 });
    expect(report.byCategory.map((c) => [c.name, c.salesRappen])).toEqual([
      ['Reis', 8_410],
      ['Biere', 2_100],
      [null, 500],
    ]);
    const sum = (list: { salesRappen: number }[]) => list.reduce((t, l) => t + l.salesRappen, 0);
    expect(sum(report.byProduct)).toBe(report.salesRappen);
    expect(sum(report.byCategory)).toBe(report.salesRappen);
  });
});

describe('voids, discounts and refunds by person (RF-F06)', () => {
  it('who, why and how much, newest first', () => {
    const report = adjustmentsReport({
      voids: [
        {
          at: '2026-10-09T18:00:00Z',
          userId: 'anna',
          authorizedByUserId: 'marco',
          reason: 'wrong_item',
          productName: 'Bier',
          quantity: 1,
          grossRappen: 700,
          orderNumber: 'K1-0001',
        },
        {
          at: '2026-10-09T20:00:00Z',
          userId: 'anna',
          authorizedByUserId: null,
          reason: 'wrong_item',
          productName: 'Wein',
          quantity: 2,
          grossRappen: 1_800,
          orderNumber: 'K1-0002',
        },
      ],
      discounts: [
        {
          at: '2026-10-09T19:00:00Z',
          userId: 'luca',
          authorizedByUserId: 'marco',
          reason: 'staff',
          amountRappen: 1_000,
          orderNumber: 'K1-0003',
        },
      ],
      refunds: [
        {
          at: '2026-10-09T21:00:00Z',
          userId: 'marco',
          authorizedByUserId: null,
          reason: 'Kalt',
          amountRappen: 2_450,
          orderNumber: 'K1-0004',
        },
      ],
    });
    expect(report.voids).toEqual({ count: 2, rappen: 2_500 });
    expect(report.discounts).toEqual({ count: 1, rappen: 1_000 });
    expect(report.refunds).toEqual({ count: 1, rappen: 2_450 });
    expect(report.byPerson.map((p) => p.userId)).toEqual(['anna', 'marco', 'luca']);
    expect(report.byReason[0]).toEqual({
      kind: 'void',
      reason: 'wrong_item',
      count: 2,
      rappen: 2_500,
    });
    expect(report.records.voids.map((v) => v.orderNumber)).toEqual(['K1-0002', 'K1-0001']);
  });
});

describe('kitchen and table times (RF-F08)', () => {
  it('median and 90th percentile by nearest rank', () => {
    expect(durationStats([])).toBeNull();
    expect(durationStats([600, 60, 300, 120, 180, 240, 360, 420, 480, 3_600])).toEqual({
      count: 10,
      averageSeconds: 636,
      medianSeconds: 300,
      p90Seconds: 600,
      maxSeconds: 3_600,
    });
    // A negative duration (clock skew) is left out.
    expect(durationStats([-5, 100])?.count).toBe(1);
  });

  it('send → ready by station and product, slowest first', () => {
    const at = (minutes: number) => new Date(Date.UTC(2026, 9, 9, 18, minutes)).toISOString();
    const report = kitchenTimesReport([
      { stationId: 'bar', productId: 'beer', productName: 'Bier', sentAt: at(0), readyAt: at(2) },
      {
        stationId: 'kitchen',
        productId: 'paella',
        productName: 'Paella',
        sentAt: at(0),
        readyAt: at(25),
      },
      {
        stationId: 'kitchen',
        productId: 'paella',
        productName: 'Paella',
        sentAt: at(10),
        readyAt: at(30),
      },
      {
        stationId: 'kitchen',
        productId: 'soup',
        productName: 'Suppe',
        sentAt: at(0),
        readyAt: at(8),
      },
    ]);
    expect(report.byStation.map((s) => [s.stationId, s.stats.count])).toEqual([
      ['kitchen', 3],
      ['bar', 1],
    ]);
    expect(report.byProduct[0]).toMatchObject({
      productName: 'Paella',
      stats: { count: 2, averageSeconds: 1_350, medianSeconds: 1_200 },
    });
    expect(report.overall?.count).toBe(4);
  });

  it('table times by table, with the guests', () => {
    const report = tableTimesReport([
      {
        tableId: 't1',
        openedAt: '2026-10-09T18:00:00Z',
        closedAt: '2026-10-09T19:30:00Z',
        guestCount: 4,
      },
      {
        tableId: 't1',
        openedAt: '2026-10-09T20:00:00Z',
        closedAt: '2026-10-09T21:00:00Z',
        guestCount: 2,
      },
      {
        tableId: 't2',
        openedAt: '2026-10-09T19:00:00Z',
        closedAt: '2026-10-09T19:45:00Z',
        guestCount: null,
      },
    ]);
    expect(report.overall).toMatchObject({ count: 3, medianSeconds: 3_600 });
    expect(report.byTable[0]).toMatchObject({ tableId: 't1', guests: 6, stats: { count: 2 } });
  });
});
