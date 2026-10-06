import type { people } from '@pos/api';

/** Select value for "no station / no printer": Radix Select items cannot have an empty value. */
export const NONE = 'none';

export const toOption = (value: string | null) => value ?? NONE;
export const fromOption = (value: string) => (value === NONE ? null : value);

/** What a select offers: the active entries plus the one currently assigned, even if inactive. */
export function selectable<T extends { id: string; isActive: boolean }>(
  items: T[],
  current: string | null,
): T[] {
  return items.filter((item) => item.isActive || item.id === current);
}

export type DevicesData = {
  terminals: people.TerminalDto[];
  stations: people.KitchenStationDto[];
  printers: people.PrinterDto[];
};
