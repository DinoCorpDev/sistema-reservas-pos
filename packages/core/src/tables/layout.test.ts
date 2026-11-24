import { describe, expect, it } from 'vitest';
import {
  findFreeSpot,
  type FloorPhotoReading,
  gridOf,
  nextTableLabel,
  planFromPhoto,
  saveFloorLayoutSchema,
  tablesOverlap,
} from './layout';

const box = (posX: number, posY: number, width = 1, height = 1) => ({ posX, posY, width, height });
const seen = (
  x: number,
  y: number,
  label: string | null = null,
  extra: Partial<FloorPhotoReading['tables'][number]> = {},
) => ({ label, shape: 'rect' as const, x, y, width: 10, height: 10, seats: null, ...extra });

describe('the floor grid (DEC-056)', () => {
  it('tells touching tables from overlapping ones', () => {
    expect(tablesOverlap(box(0, 0, 2), box(2, 0))).toBe(false);
    expect(tablesOverlap(box(0, 0, 2), box(1, 0))).toBe(true);
    expect(tablesOverlap(box(0, 0, 1, 2), box(0, 1))).toBe(true);
  });

  it('finds the first free place row by row, or none', () => {
    expect(findFreeSpot([box(0, 0), box(1, 0)], { width: 1, height: 1 }, 4, 4)).toEqual({
      posX: 2,
      posY: 0,
    });
    const full = Array.from({ length: 4 }, (_, i) => box(i, 0));
    expect(findFreeSpot(full, { width: 1, height: 1 }, 4, 1)).toBeNull();
  });

  it('sizes the grid to the tables, at least 4 and at most 16 per side', () => {
    expect(gridOf([])).toEqual({ cols: 4, rows: 4 });
    expect(gridOf([box(6, 2, 2)])).toEqual({ cols: 8, rows: 4 });
  });

  it('numbers new tables after the labels already used', () => {
    expect(nextTableLabel(new Set(['1', '2', '4']))).toBe('3');
  });
});

describe('saving a plan', () => {
  const table = (posX: number, label: string) => ({
    label,
    capacity: 4,
    shape: 'rect' as const,
    posX,
    posY: 0,
    width: 2,
    height: 1,
  });

  it('accepts tables side by side, new and existing', () => {
    const parsed = saveFloorLayoutSchema.parse({ tables: [table(0, '1'), table(2, '2')] });
    expect(parsed.tables[0]?.id).toBeNull();
  });

  it('refuses overlaps, repeated labels and tables outside the grid', () => {
    const issues = (tables: unknown[]) =>
      saveFloorLayoutSchema.safeParse({ tables }).error?.issues.map((i) => i.message);
    expect(issues([table(0, '1'), table(1, '2')])).toEqual(['Tables overlap']);
    expect(issues([table(0, 'A'), table(4, 'a')])).toEqual(['Repeated label']);
    expect(issues([table(15, '1')])).toEqual(['Outside the grid']);
  });
});

describe('a plan from a photo (the AI proposes, PA-07)', () => {
  it('keeps the arrangement of the room on the grid, in reading order', () => {
    const plan = planFromPhoto({
      tables: [seen(10, 10, '1'), seen(40, 10, '2'), seen(70, 10, '3'), seen(10, 60, '4')],
      notes: null,
    });
    expect(plan.map((t) => t.label)).toEqual(['1', '2', '3', '4']);
    const [one, two, three, four] = plan;
    expect(one!.posY).toBe(two!.posY);
    expect(two!.posX).toBeGreaterThan(one!.posX);
    expect(three!.posX).toBeGreaterThan(two!.posX);
    expect(four!.posY).toBeGreaterThan(one!.posY);
    expect(four!.posX).toBe(one!.posX);
  });

  it('never leaves two tables on top of each other, and stays inside 16 × 16', () => {
    const crowded = Array.from({ length: 30 }, (_, i) => seen((i % 6) * 3, Math.floor(i / 6) * 3));
    const plan = planFromPhoto({ tables: crowded, notes: null });
    expect(plan).toHaveLength(30);
    for (let i = 0; i < plan.length; i += 1) {
      expect(plan[i]!.posX + plan[i]!.width).toBeLessThanOrEqual(16);
      expect(plan[i]!.posY + plan[i]!.height).toBeLessThanOrEqual(16);
      for (let j = 0; j < i; j += 1) expect(tablesOverlap(plan[i]!, plan[j]!)).toBe(false);
    }
  });

  it('makes a long table longer on the grid', () => {
    const plan = planFromPhoto({
      tables: [seen(0, 0, 'A'), seen(30, 0, 'B', { width: 25 }), seen(0, 40, 'C')],
      notes: null,
    });
    expect(plan.find((t) => t.label === 'B')!.width).toBeGreaterThan(1);
  });

  it('numbers tables without a usable label after the labels already taken', () => {
    const plan = planFromPhoto(
      {
        tables: [
          seen(0, 0, null),
          seen(30, 0, 'Terrasse 12 am Fenster'),
          seen(60, 0, '5'),
          seen(0, 40, '5'),
          seen(30, 40, '2'),
        ],
        notes: null,
      },
      { takenLabels: new Set(['1', '2']) },
    );
    // "2" is used in another area: it would clash on saving, so it is renumbered too.
    expect(plan.map((t) => t.label)).toEqual(['3', '4', '5', '6', '7']);
  });

  it('uses the seats it counted, or a sensible default', () => {
    const plan = planFromPhoto({
      tables: [seen(0, 0, '1', { seats: 2, shape: 'round' }), seen(40, 0, '2', { seats: 0 })],
      notes: null,
    });
    expect(plan[0]).toMatchObject({ capacity: 2, shape: 'round' });
    expect(plan[1]!.capacity).toBe(4);
  });

  it('ignores boxes outside the photo or without size, and an empty reading', () => {
    expect(planFromPhoto({ tables: [], notes: 'Kein Tisch erkannt' })).toEqual([]);
    const plan = planFromPhoto({
      tables: [seen(120, 120), seen(10, 10, '1', { width: 0 }), seen(-5, -5, '2')],
      notes: null,
    });
    expect(plan.map((t) => t.label)).toEqual(['2']);
    expect(plan[0]).toMatchObject({ posX: 0, posY: 0 });
  });
});
