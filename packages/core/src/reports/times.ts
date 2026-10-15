/**
 * Kitchen and table times (RF-F08): how long the kitchen takes from the send to "ready", by
 * station and by product, and how long a table stays open. Median and 90th percentile next to
 * the average, so one forgotten ticket does not hide how the service really went.
 */

export interface DurationStats {
  count: number;
  averageSeconds: number;
  medianSeconds: number;
  p90Seconds: number;
  maxSeconds: number;
}

/** Statistics of durations in seconds (negative or missing ones are left out). */
export function durationStats(seconds: readonly number[]): DurationStats | null {
  const values = seconds
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  if (values.length === 0) return null;
  // Nearest rank: the smallest value with at least p% of the values at or below it.
  const rank = (p: number) => values[Math.max(0, Math.ceil((p / 100) * values.length) - 1)]!;
  return {
    count: values.length,
    averageSeconds: Math.round(values.reduce((total, value) => total + value, 0) / values.length),
    medianSeconds: rank(50),
    p90Seconds: rank(90),
    maxSeconds: values[values.length - 1]!,
  };
}

const secondsBetween = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 1000;

export interface KitchenTimeRecord {
  stationId: string;
  productId: string | null;
  productName: string;
  sentAt: string;
  readyAt: string;
}

export interface KitchenTimesReport {
  overall: DurationStats | null;
  byStation: { stationId: string; stats: DurationStats }[];
  byProduct: {
    stationId: string;
    productId: string | null;
    productName: string;
    stats: DurationStats;
  }[];
}

/** Send → ready per item and station (RF-C24 timers, RF-F08). */
export function kitchenTimesReport(records: readonly KitchenTimeRecord[]): KitchenTimesReport {
  const duration = (record: KitchenTimeRecord) => secondsBetween(record.sentAt, record.readyAt);
  const groups = <K>(keyOf: (record: KitchenTimeRecord) => K) => {
    const map = new Map<K, KitchenTimeRecord[]>();
    for (const record of records) {
      const key = keyOf(record);
      map.set(key, [...(map.get(key) ?? []), record]);
    }
    return [...map.entries()];
  };
  const byStation = groups((record) => record.stationId).flatMap(([stationId, list]) => {
    const stats = durationStats(list.map(duration));
    return stats ? [{ stationId, stats }] : [];
  });
  const byProduct = groups(
    (record) => `${record.stationId}|${record.productId ?? record.productName}`,
  ).flatMap(([, list]) => {
    const stats = durationStats(list.map(duration));
    const first = list[0]!;
    return stats
      ? [
          {
            stationId: first.stationId,
            productId: first.productId,
            productName: first.productName,
            stats,
          },
        ]
      : [];
  });
  const slowest = (a: { stats: DurationStats }, b: { stats: DurationStats }) =>
    b.stats.medianSeconds - a.stats.medianSeconds;
  return {
    overall: durationStats(records.map(duration)),
    byStation: byStation.sort(slowest),
    byProduct: byProduct.sort(slowest),
  };
}

export interface TableTimeRecord {
  tableId: string;
  openedAt: string;
  closedAt: string;
  guestCount: number | null;
}

/** Opening → closing of the table orders (RF-F08): overall and by table. */
export function tableTimesReport(records: readonly TableTimeRecord[]): {
  overall: DurationStats | null;
  byTable: { tableId: string; stats: DurationStats; guests: number }[];
} {
  const map = new Map<string, TableTimeRecord[]>();
  for (const record of records)
    map.set(record.tableId, [...(map.get(record.tableId) ?? []), record]);
  const duration = (record: TableTimeRecord) => secondsBetween(record.openedAt, record.closedAt);
  return {
    overall: durationStats(records.map(duration)),
    byTable: [...map.entries()]
      .flatMap(([tableId, list]) => {
        const stats = durationStats(list.map(duration));
        return stats
          ? [{ tableId, stats, guests: list.reduce((total, r) => total + (r.guestCount ?? 0), 0) }]
          : [];
      })
      .sort((a, b) => b.stats.count - a.stats.count),
  };
}
