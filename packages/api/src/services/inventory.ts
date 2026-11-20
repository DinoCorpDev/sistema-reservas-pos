/**
 * Inventory use cases (DEC-051): raw materials with their stock and low level, recipes per
 * product, variant and modifier option, and stock movements entered by hand. What sales take is
 * projected on sync (inventory/projection.ts).
 */
export * from './inventory/ingredients';
export * from './inventory/movements';
export * from './inventory/recipes';
