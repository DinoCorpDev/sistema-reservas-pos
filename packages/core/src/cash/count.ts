import { z } from 'zod';
import { addRappen, multiplyRappen, type Rappen, rappen, ZERO_RAPPEN } from '../shared/money';
import {
  CHF_DENOMINATIONS,
  type ChfDenomination,
  COP_DENOMINATIONS,
  type CopDenomination,
} from './constants';

/**
 * A denomination as the key of a count: its value in minor units, as text ("500" = CHF 5,
 * "200000" = $2.000). The keys of every currency are valid, so a count never depends on where
 * it is checked (DEC-047).
 */
export type DenominationKey = `${ChfDenomination}` | `${CopDenomination}`;
export const DENOMINATION_KEYS = [...new Set<number>([...CHF_DENOMINATIONS, ...COP_DENOMINATIONS])]
  .sort((a, b) => a - b)
  .map(String) as [DenominationKey, ...DenominationKey[]];

/** How many pieces of each denomination were counted (RF-D12, RF-D14); missing = none. */
export type DenominationCount = Partial<Record<DenominationKey, number>>;

export const denominationCountSchema = z.partialRecord(
  z.enum(DENOMINATION_KEYS),
  z.int().min(0).max(99_999),
);

/** The cash a count adds up to (RF-D14): Σ pieces × value. */
export function countTotal(count: DenominationCount): Rappen {
  let total = ZERO_RAPPEN;
  for (const key of DENOMINATION_KEYS) {
    const pieces = count[key] ?? 0;
    if (!Number.isInteger(pieces) || pieces < 0) {
      throw new RangeError(`Invalid count for ${key}: ${pieces}`);
    }
    total = addRappen(total, multiplyRappen(rappen(Number(key)), pieces));
  }
  return total;
}
