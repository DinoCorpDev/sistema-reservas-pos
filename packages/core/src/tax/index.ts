/**
 * Tax module: Swiss MWST. Tax-inclusive prices (tax is extracted, never added), rate decided
 * by tax category + channel + consumption type and frozen on the line (RN-01…RN-07).
 * The calculation and its exhaustive tests are the gate of Phase 1.
 */
export * from './constants';
export * from './calculation';
export * from './commands';
