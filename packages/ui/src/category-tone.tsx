/**
 * Category colours (DEC-053): eight soft tones from the brandbook's support palette. A category
 * has no colour column; its tone comes from its position in the menu (stable while the order does
 * not change) or, without a list at hand, from its id. The same rule runs in every screen.
 */
const TONES = [
  'bg-(--cat-1-bg) text-(--cat-1-fg)',
  'bg-(--cat-2-bg) text-(--cat-2-fg)',
  'bg-(--cat-3-bg) text-(--cat-3-fg)',
  'bg-(--cat-4-bg) text-(--cat-4-fg)',
  'bg-(--cat-5-bg) text-(--cat-5-fg)',
  'bg-(--cat-6-bg) text-(--cat-6-fg)',
  'bg-(--cat-7-bg) text-(--cat-7-fg)',
  'bg-(--cat-8-bg) text-(--cat-8-fg)',
] as const;

/** The solid colour of each tone: a dot or a stripe that marks a category (POS, DEC-053). */
const SOLIDS = [
  'bg-(--cat-1-fg)',
  'bg-(--cat-2-fg)',
  'bg-(--cat-3-fg)',
  'bg-(--cat-4-fg)',
  'bg-(--cat-5-fg)',
  'bg-(--cat-6-fg)',
  'bg-(--cat-7-fg)',
  'bg-(--cat-8-fg)',
] as const;

export const TONE_COUNT = TONES.length;

/** Solid colour classes for the i-th category of an ordered list. */
export function solidByIndex(index: number): string {
  return SOLIDS[((index % SOLIDS.length) + SOLIDS.length) % SOLIDS.length]!;
}

/** FNV-1a: a small, stable hash of a string. */
function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Tone classes for the i-th category of an ordered list. */
export function toneByIndex(index: number): string {
  return TONES[((index % TONES.length) + TONES.length) % TONES.length]!;
}

/** Tone classes from a stable key (an id, a name); neutral when there is none. */
export function toneByKey(key: string | null | undefined): string {
  return key ? TONES[hash(key) % TONES.length]! : 'bg-muted text-muted-foreground';
}
