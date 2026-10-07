import type { MenuProduct } from '../catalog/menu';
import { validateModifierSelection } from '../catalog/rules';
import type { ConsumptionType } from '../shared/channels';
import {
  type IsoDate,
  resolveTaxRate,
  type TaxRateRecord,
  type TaxRuleRecord,
} from '../tax/calculation';
import { MAX_COURSE, MIN_COURSE } from './constants';
import type { LineSnapshot } from './operations';

export type LineErrorCode =
  'NOT_ORDERABLE' | 'UNKNOWN_VARIANT' | 'INVALID_MODIFIERS' | 'INVALID_QUANTITY' | 'INVALID_COURSE';

export class LineError extends Error {
  override readonly name = 'LineError';
  constructor(
    readonly code: LineErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export interface LineSelection {
  product: MenuProduct;
  variantId: string | null;
  modifiers: readonly { modifierId: string; quantity: number }[];
  quantity: number;
  note: string | null;
  seat: number | null;
  course?: number;
}

/**
 * Builds the frozen line of `items.add` on the device (RF-C08, RN-04, RN-17): the product must
 * be orderable for the channel right now, the modifier selection must respect its groups, and
 * price, rate and tax are fixed as of the sale date. Ids come from the caller (the reducer never
 * creates them).
 */
export function buildLineSnapshot(input: {
  selection: LineSelection;
  ids: { itemId: string; modifierRowIds: readonly string[] };
  consumptionType: ConsumptionType;
  saleDate: IsoDate;
  taxRules: readonly TaxRuleRecord[];
  taxRates: readonly TaxRateRecord[];
}): LineSnapshot {
  const { selection, ids } = input;
  const { product } = selection;
  if (!product.orderable) {
    throw new LineError('NOT_ORDERABLE', `${product.name} cannot be ordered now`, {
      reason: product.reason,
    });
  }
  if (!Number.isInteger(selection.quantity) || selection.quantity < 1 || selection.quantity > 999) {
    throw new LineError('INVALID_QUANTITY', `Invalid quantity ${selection.quantity}`);
  }
  const course = selection.course ?? product.defaultCourse;
  if (!Number.isInteger(course) || course < MIN_COURSE || course > MAX_COURSE) {
    throw new LineError('INVALID_COURSE', `Invalid course ${course}`);
  }

  let variant: MenuProduct['variants'][number] | null = null;
  if (selection.variantId !== null) {
    variant = product.variants.find((v) => v.id === selection.variantId) ?? null;
    if (!variant) throw new LineError('UNKNOWN_VARIANT', 'Unknown variant');
  } else if (product.variants.length > 0) {
    variant = product.variants.find((v) => v.isDefault) ?? product.variants[0]!;
  }

  const issues = validateModifierSelection(
    product.modifierGroups.map((group) => ({
      id: group.id,
      minSelect: group.minSelect,
      maxSelect: group.maxSelect,
      modifierIds: group.modifiers.map((m) => m.id),
    })),
    selection.modifiers,
  );
  if (issues.length > 0) {
    throw new LineError('INVALID_MODIFIERS', 'The modifier selection is not valid', issues);
  }
  if (ids.modifierRowIds.length < selection.modifiers.length) {
    throw new LineError('INVALID_MODIFIERS', 'Missing ids for the modifier rows');
  }
  const modifierById = new Map(
    product.modifierGroups.flatMap((group) => group.modifiers.map((m) => [m.id, m] as const)),
  );

  const rate = resolveTaxRate({
    taxCategoryKey: product.taxCategoryKey,
    consumptionType: input.consumptionType,
    saleDate: input.saleDate,
    rules: input.taxRules,
    rates: input.taxRates,
  });

  return {
    itemId: ids.itemId,
    productId: product.id,
    variantId: variant?.id ?? null,
    name: product.name,
    variantName: variant && product.variants.length > 1 ? variant.name : null,
    quantity: selection.quantity,
    unitPriceRappen: variant?.priceRappen ?? product.priceRappen,
    modifiers: selection.modifiers.map((choice, index) => {
      const modifier = modifierById.get(choice.modifierId)!;
      return {
        id: ids.modifierRowIds[index]!,
        modifierId: modifier.id,
        name: modifier.name,
        priceDeltaRappen: modifier.priceDeltaRappen,
        quantity: choice.quantity,
      };
    }),
    taxCategoryKey: rate.taxCategoryKey,
    taxRateCode: rate.rateCode,
    taxRateBp: rate.rateBp,
    course,
    seat: selection.seat,
    note: selection.note && selection.note.trim() !== '' ? selection.note.trim() : null,
    stationIds: [...product.stationIds],
  };
}
