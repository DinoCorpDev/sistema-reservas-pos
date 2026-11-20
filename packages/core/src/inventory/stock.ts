/**
 * Stock of a raw material (DEC-051): what came in or went out by hand (purchases, waste,
 * adjustments, counts) minus what sales and kitchen waste took. Nothing is ever edited: a
 * count is stored as the difference it makes.
 */
export const MOVEMENT_KINDS = ['purchase', 'waste', 'adjustment', 'count'] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

/**
 * Signed change in stock of a movement. Purchase and waste take a positive amount; an
 * adjustment is already signed; a count says how much there IS, so it moves the difference.
 */
export function movementDelta(kind: MovementKind, quantity: number, onHand: number): number {
  switch (kind) {
    case 'purchase':
      return quantity;
    case 'waste':
      return -quantity;
    case 'adjustment':
      return quantity;
    case 'count':
      return quantity - onHand;
  }
}

/** Low when at or under the level the restaurant chose; without a level, never. */
export function isLowStock(onHand: number, threshold: number | null): boolean {
  return threshold !== null && onHand <= threshold;
}
