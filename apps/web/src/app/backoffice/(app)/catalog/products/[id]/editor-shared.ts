import type { catalog, inventory } from '@pos/api';

/** Tabs of the product sheet; `?tab=` opens one directly. */
export const EDITOR_TABS = [
  'basics',
  'recipe',
  'prices',
  'modifiers',
  'allergens',
  'translations',
  'availability',
  'stations',
] as const;
export type EditorTab = (typeof EDITOR_TABS)[number];

/** What the signed-in person may change; the server checks every save again (RNF-10). */
export interface EditorPermissions {
  /** catalog.manage: every edit. */
  manage: boolean;
  /** catalog.price_change: base, variant, channel and location prices. */
  priceChange: boolean;
  /** catalog.sold_out: "86". */
  soldOut: boolean;
  /** inventory.manage: the recipe tab (DEC-051). */
  inventory: boolean;
}

/** The dish's recipe and the raw materials to build it from; null without inventory.manage. */
export interface RecipeData {
  ingredients: inventory.IngredientDto[];
  product: inventory.RecipesDto['products'][number] | null;
}

/** The current location: languages for the translations and the place of the "86". */
export interface EditorLocation {
  id: string;
  name: string;
  defaultLanguage: string;
  languages: string[];
}

/** Every tab edits one part of the product; its save answers with the whole product. */
export interface TabProps {
  product: catalog.ProductDto;
  permissions: EditorPermissions;
}
