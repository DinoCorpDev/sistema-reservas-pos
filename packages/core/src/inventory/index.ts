/**
 * Inventory module (DEC-051): raw materials, recipes per product, variant and modifier option,
 * manual stock movements and the consumption derived from what is sold. The use cases live in
 * packages/api; here are the rules they share.
 */
export * from './units';
export * from './recipes';
export * from './consumption';
export * from './stock';
export * from './commands';
