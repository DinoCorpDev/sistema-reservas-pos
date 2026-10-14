import { type Allergen, ALLERGENS } from '../catalog/constants';

/**
 * Allergies at the table (DEC-037): what a guest of the order is allergic to, whatever they
 * ordered. The kitchen sees it on every ticket of the order, so it keeps that ingredient away
 * from everything it prepares for them (cross-contamination). One of the 14 allergens or any
 * free text ("kiwi", "seat 2: strawberries").
 */
export interface OrderAllergies {
  allergens: Allergen[];
  note: string | null;
}

/** Allergens in the canonical order, without duplicates; nothing at all becomes null. */
export function normalizeAllergies(
  input: { allergens: readonly string[]; note: string | null } | null,
): OrderAllergies | null {
  if (!input) return null;
  const wanted = new Set(input.allergens);
  const allergens = ALLERGENS.filter((allergen) => wanted.has(allergen));
  const note = input.note?.trim() || null;
  return allergens.length === 0 && note === null ? null : { allergens, note };
}

/** Two orders become one (merge): the result keeps every warning of both. */
export function mergeAllergies(
  a: OrderAllergies | null,
  b: OrderAllergies | null,
): OrderAllergies | null {
  if (!a) return b && { allergens: [...b.allergens], note: b.note };
  if (!b) return { allergens: [...a.allergens], note: a.note };
  const notes = [...new Set([a.note, b.note].filter((note): note is string => note !== null))];
  return normalizeAllergies({
    allergens: [...a.allergens, ...b.allergens],
    note: notes.length > 0 ? notes.join(' · ') : null,
  });
}

/** The flagged allergens a product contains or may contain (for the waiter's warning). */
export function allergenClashes(
  allergies: OrderAllergies | null,
  productAllergens: readonly { allergen: string }[],
): Allergen[] {
  if (!allergies) return [];
  const present = new Set(productAllergens.map((entry) => entry.allergen));
  return allergies.allergens.filter((allergen) => present.has(allergen));
}
