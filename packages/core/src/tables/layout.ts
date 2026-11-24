import { z } from 'zod';

/**
 * The floor plan of an area (DEC-056): tables on a grid of at most 16 × 16 cells, the same grid
 * the POS draws (`planLayout` in the floor view). Pure: the editor, the API and the reading of
 * a photo by the AI share these rules, and the AI only proposes (PA-07).
 */

export const FLOOR_GRID_MAX = 16;
export const FLOOR_GRID_MIN = 4;
export const TABLE_SHAPES = ['rect', 'round'] as const;
export type TableShape = (typeof TABLE_SHAPES)[number];

export interface GridBox {
  posX: number;
  posY: number;
  width: number;
  height: number;
}

export const tablesOverlap = (a: GridBox, b: GridBox): boolean =>
  a.posX < b.posX + b.width &&
  b.posX < a.posX + a.width &&
  a.posY < b.posY + b.height &&
  b.posY < a.posY + a.height;

export const fitsGrid = (box: GridBox, cols: number, rows: number): boolean =>
  box.posX >= 0 && box.posY >= 0 && box.posX + box.width <= cols && box.posY + box.height <= rows;

/** The grid a set of tables needs, never smaller than `FLOOR_GRID_MIN` per side. */
export function gridOf(boxes: readonly GridBox[]): { cols: number; rows: number } {
  let cols = FLOOR_GRID_MIN;
  let rows = FLOOR_GRID_MIN;
  for (const box of boxes) {
    cols = Math.max(cols, box.posX + box.width);
    rows = Math.max(rows, box.posY + box.height);
  }
  return { cols: Math.min(cols, FLOOR_GRID_MAX), rows: Math.min(rows, FLOOR_GRID_MAX) };
}

/** The first free place for a box of this size, row by row; null when the grid is full. */
export function findFreeSpot(
  placed: readonly GridBox[],
  size: { width: number; height: number },
  cols: number,
  rows: number,
): { posX: number; posY: number } | null {
  for (let posY = 0; posY + size.height <= rows; posY += 1) {
    for (let posX = 0; posX + size.width <= cols; posX += 1) {
      const box = { posX, posY, ...size };
      if (!placed.some((other) => tablesOverlap(box, other))) return { posX, posY };
    }
  }
  return null;
}

/** The next free number as a label ("1", "2"…), avoiding every label already used. */
export function nextTableLabel(taken: ReadonlySet<string>): string {
  for (let n = 1; ; n += 1) {
    const label = String(n);
    if (!taken.has(label)) return label;
  }
}

// ── Saving a plan ───────────────────────────────────────────────────────────

const cell = z
  .int()
  .min(0)
  .max(FLOOR_GRID_MAX - 1);
const span = z.int().min(1).max(FLOOR_GRID_MAX);

export const floorTableSchema = z.object({
  /** An existing table of the area; without it, a new table. */
  id: z.uuid().nullable().default(null),
  label: z.string().trim().min(1).max(16),
  capacity: z.int().min(1).max(50),
  shape: z.enum(TABLE_SHAPES),
  posX: cell,
  posY: cell,
  width: span,
  height: span,
});
export type FloorTableInput = z.infer<typeof floorTableSchema>;

/** The whole plan of an area as the editor shows it: in the grid, no overlaps, unique labels. */
export const saveFloorLayoutSchema = z
  .object({ tables: z.array(floorTableSchema).max(200) })
  .superRefine(({ tables }, ctx) => {
    const labels = new Set<string>();
    tables.forEach((table, index) => {
      if (!fitsGrid(table, FLOOR_GRID_MAX, FLOOR_GRID_MAX)) {
        ctx.addIssue({ code: 'custom', message: 'Outside the grid', path: ['tables', index] });
      }
      const label = table.label.toLowerCase();
      if (labels.has(label)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Repeated label',
          path: ['tables', index, 'label'],
        });
      }
      labels.add(label);
      for (let other = 0; other < index; other += 1) {
        if (tablesOverlap(table, tables[other]!)) {
          ctx.addIssue({ code: 'custom', message: 'Tables overlap', path: ['tables', index] });
          break;
        }
      }
    });
  });
export type SaveFloorLayoutInput = z.infer<typeof saveFloorLayoutSchema>;

// ── Reading a photo (the AI proposes, a person confirms: PA-07) ─────────────

/**
 * What the AI returns for one table it sees: its box in percent of the photo (0 = left/top,
 * 100 = right/bottom), the number written on it if any, and the seats it counts.
 */
export const photoTableSchema = z.object({
  label: z.string().nullable(),
  shape: z.enum(TABLE_SHAPES),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  seats: z.number().nullable(),
});
export const floorPhotoReadingSchema = z.object({
  tables: z.array(photoTableSchema).max(200),
  /** Anything the person should check (tables hidden, a blurry corner…). */
  notes: z.string().nullable(),
});
export type FloorPhotoReading = z.infer<typeof floorPhotoReadingSchema>;

/** The same shape as JSON Schema, for the structured output of the model. */
export const FLOOR_PHOTO_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tables', 'notes'],
  properties: {
    tables: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'shape', 'x', 'y', 'width', 'height', 'seats'],
        properties: {
          label: {
            type: ['string', 'null'],
            description: 'The number or name written on or next to the table, or null',
          },
          shape: { type: 'string', enum: [...TABLE_SHAPES] },
          x: { type: 'number', description: 'Left edge, percent of the image width (0-100)' },
          y: { type: 'number', description: 'Top edge, percent of the image height (0-100)' },
          width: { type: 'number', description: 'Width, percent of the image width' },
          height: { type: 'number', description: 'Height, percent of the image height' },
          seats: {
            type: ['integer', 'null'],
            description: 'Chairs or places counted around the table, or null if unclear',
          },
        },
      },
    },
    notes: {
      type: ['string', 'null'],
      description: 'Short note for the owner about what could not be read well, or null',
    },
  },
} as const;

export interface PlannedTable extends GridBox {
  label: string;
  shape: TableShape;
  capacity: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** Seats when the AI could not count them: by the size of the table. */
const defaultCapacity = (box: GridBox) => (box.width * box.height >= 2 ? 6 : 4);

/**
 * Turns what the AI saw into a plan on the grid: the boxes are scaled so the usual table is one
 * cell, snapped, kept inside 16 × 16 and moved apart when they touch; a label that is missing,
 * too long, repeated or used elsewhere becomes the next free number (`takenLabels`: every label
 * the location already uses outside this plan). Deterministic.
 */
export function planFromPhoto(
  reading: FloorPhotoReading,
  options: { takenLabels?: ReadonlySet<string> } = {},
): PlannedTable[] {
  const boxes = reading.tables
    .map((table) => {
      const x = clamp(table.x, 0, 100);
      const y = clamp(table.y, 0, 100);
      return {
        ...table,
        x,
        y,
        width: clamp(table.width, 0, 100 - x),
        height: clamp(table.height, 0, 100 - y),
      };
    })
    .filter((table) => table.width > 0.5 && table.height > 0.5);
  if (boxes.length === 0) return [];

  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const spanX = Math.max(...boxes.map((b) => b.x + b.width)) - minX;
  const spanY = Math.max(...boxes.map((b) => b.y + b.height)) - minY;
  // One cell ≈ the usual (median) table, with a little room between neighbours; a big room is
  // scaled down so it fits in 16 cells.
  const perCellX = Math.max(median(boxes.map((b) => b.width)) * 1.25, spanX / FLOOR_GRID_MAX);
  const perCellY = Math.max(median(boxes.map((b) => b.height)) * 1.25, spanY / FLOOR_GRID_MAX);

  const snapped = boxes
    .map((b, index) => {
      const width = clamp(Math.round(b.width / perCellX), 1, 4);
      const height = clamp(Math.round(b.height / perCellY), 1, 4);
      const centerX = (b.x - minX + b.width / 2) / perCellX;
      const centerY = (b.y - minY + b.height / 2) / perCellY;
      return {
        index,
        source: b,
        width,
        height,
        posX: clamp(Math.round(centerX - width / 2), 0, FLOOR_GRID_MAX - width),
        posY: clamp(Math.round(centerY - height / 2), 0, FLOOR_GRID_MAX - height),
      };
    })
    // Top to bottom, left to right: the order a person reads the room.
    .sort((a, b) => a.posY - b.posY || a.posX - b.posX || a.index - b.index);

  // Every table gets a place: where it was seen, or the nearest free one.
  const placed: (GridBox & { source: (typeof boxes)[number] })[] = [];
  for (const table of snapped) {
    let box: GridBox = table;
    if (placed.some((other) => tablesOverlap(box, other))) {
      box = nearestFree(placed, table) ?? {
        ...table,
        width: 1,
        height: 1,
        ...(findFreeSpot(placed, { width: 1, height: 1 }, FLOOR_GRID_MAX, FLOOR_GRID_MAX) ?? {
          posX: 0,
          posY: 0,
        }),
      };
      if (placed.some((other) => tablesOverlap(box, other))) continue; // 256 cells are full
    }
    placed.push({ ...box, source: table.source });
  }

  const used = new Set(options.takenLabels ?? []);
  const taken = new Set([...used].map((label) => label.toLowerCase()));
  const seen = new Set<string>();
  const labels = placed.map(({ source }) => {
    const label = source.label?.trim() ?? '';
    // A name another area already uses would clash on saving: it gets a free number instead.
    const usable =
      label.length > 0 &&
      label.length <= 16 &&
      !seen.has(label.toLowerCase()) &&
      !taken.has(label.toLowerCase());
    if (usable) seen.add(label.toLowerCase());
    return usable ? label : null;
  });
  for (const label of labels) if (label) used.add(label);

  return placed.map((box, index) => {
    let label = labels[index];
    if (!label) {
      label = nextTableLabel(used);
      used.add(label);
    }
    const seats = box.source.seats;
    return {
      label,
      shape: box.source.shape,
      capacity:
        seats !== null && Number.isInteger(seats) && seats >= 1 && seats <= 50
          ? seats
          : defaultCapacity(box),
      posX: box.posX,
      posY: box.posY,
      width: box.width,
      height: box.height,
    };
  });
}

/** The free place of the same size closest to where the table was seen, within the grid. */
function nearestFree(placed: readonly GridBox[], wanted: GridBox): GridBox | null {
  let best: GridBox | null = null;
  let bestDistance = Infinity;
  for (let posY = 0; posY + wanted.height <= FLOOR_GRID_MAX; posY += 1) {
    for (let posX = 0; posX + wanted.width <= FLOOR_GRID_MAX; posX += 1) {
      const box = { posX, posY, width: wanted.width, height: wanted.height };
      if (placed.some((other) => tablesOverlap(box, other))) continue;
      const distance = Math.abs(posX - wanted.posX) + Math.abs(posY - wanted.posY);
      if (distance < bestDistance) {
        best = box;
        bestDistance = distance;
      }
    }
  }
  return best;
}

/** The photo as the browser sends it: already scaled down to 1568 px, never stored (DEC-056). */
export const FLOOR_PHOTO_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const floorPhotoSchema = z.object({
  mediaType: z.enum(FLOOR_PHOTO_MEDIA_TYPES),
  /** Base64 without the `data:` prefix; about 4 MB at most. */
  data: z
    .string()
    .min(100)
    .max(5_500_000)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Base64 image data'),
});
export type FloorPhotoInput = z.infer<typeof floorPhotoSchema>;
