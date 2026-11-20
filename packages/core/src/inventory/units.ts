/**
 * Units of the raw materials (DEC-051). Quantities are whole numbers in the base unit — grams,
 * millilitres or pieces — like money in rappen: no floats anywhere. Screens show kilos and
 * litres from 1000 up.
 */
export const STOCK_UNITS = ['g', 'ml', 'unit'] as const;
export type StockUnit = (typeof STOCK_UNITS)[number];

/** What a person types or reads: the base unit or its thousand. */
export const DISPLAY_UNITS = ['kg', 'g', 'l', 'ml', 'unit'] as const;
export type DisplayUnit = (typeof DISPLAY_UNITS)[number];

/** 1000 t, 1000 m³ or a billion pieces: far above any kitchen, far below the INT limit. */
export const MAX_STOCK_QUANTITY = 1_000_000_000;

const FACTOR: Record<DisplayUnit, number> = { kg: 1000, g: 1, l: 1000, ml: 1, unit: 1 };
const BASE: Record<DisplayUnit, StockUnit> = { kg: 'g', g: 'g', l: 'ml', ml: 'ml', unit: 'unit' };

/** The units a person may use for a raw material, the larger first. */
export function displayUnitsOf(unit: StockUnit): readonly DisplayUnit[] {
  if (unit === 'g') return ['kg', 'g'];
  if (unit === 'ml') return ['l', 'ml'];
  return ['unit'];
}

/** The unit that reads best for an amount: kg or l from 1000 g or ml, the base unit below. */
export function bestDisplayUnit(quantity: number, unit: StockUnit): DisplayUnit {
  if (unit === 'unit') return 'unit';
  const [large, small] = displayUnitsOf(unit) as [DisplayUnit, DisplayUnit];
  return Math.abs(quantity) >= 1000 ? large : small;
}

/**
 * «19,5» kg → 19500 g. Accepts a comma or a dot as decimal separator and rounds to the base
 * unit. Null for anything that is not a number, or for a display unit of another kind.
 */
export function toBaseQuantity(
  input: string | number,
  displayUnit: DisplayUnit,
  unit: StockUnit,
): number | null {
  if (BASE[displayUnit] !== unit) return null;
  const text = typeof input === 'number' ? String(input) : input.trim().replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  const value = Math.round(Number(text) * FACTOR[displayUnit]);
  return Object.is(value, -0) ? 0 : value;
}

/** 19500 g → { value: 19.5, unit: 'kg' }; the screen formats the number in its locale. */
export function fromBaseQuantity(
  quantity: number,
  unit: StockUnit,
  displayUnit: DisplayUnit = bestDisplayUnit(quantity, unit),
): { value: number; unit: DisplayUnit } {
  return { value: quantity / FACTOR[displayUnit], unit: displayUnit };
}

/** «19,5 kg», «500 g», «12» (pieces get their word on screen). */
export function formatQuantity(quantity: number, unit: StockUnit, locale: string): string {
  const shown = fromBaseQuantity(quantity, unit);
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(shown.value);
  return shown.unit === 'unit' ? number : `${number} ${shown.unit}`;
}
