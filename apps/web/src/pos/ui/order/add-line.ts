'use client';

import { allergenClashes, type Channel, type LineSelection, type MenuProduct } from '@pos/core';
import { toast } from '@pos/ui/toaster';
import { useTranslations } from 'next-intl';
import { getPos } from '@/device/store';
import { addItem } from '../../actions';
import { findProduct, menuFor } from '../../catalog';
import { useRunner } from './run';

/**
 * The product a line is built from: the menu in the location's language, so the frozen line
 * name is the one kitchen and receipts translate from, whatever language the waiter reads.
 */
export function baseProduct(channel: Channel, product: MenuProduct): MenuProduct {
  const menu = menuFor(channel);
  return (menu && findProduct(menu, product.id)) || product;
}

/** A product with a choice to make opens the dialog; anything else is added with one tap. */
export const needsChoice = (product: MenuProduct) =>
  product.variants.length > 1 || product.modifierGroups.some((group) => group.minSelect > 0);

/**
 * Adds a line to the order (RF-C08) through the action queue. A product with an allergen someone
 * at the table is allergic to is still added, with a warning to the waiter (DEC-037).
 */
export function useAddLine(orderId: string, channel: Channel) {
  const run = useRunner();
  const t = useTranslations('posOrder.allergy');
  const ta = useTranslations('posOrder.allergens');
  return (selection: LineSelection) => {
    const allergies = getPos().fold.orders.get(orderId)?.allergies ?? null;
    const clashes = allergenClashes(allergies, selection.product.allergens);
    if (clashes.length > 0) {
      toast.warning(
        t('clash', {
          product: selection.product.name,
          allergens: clashes.map((allergen) => ta(allergen)).join(', '),
        }),
      );
    }
    return run(() =>
      addItem(orderId, { ...selection, product: baseProduct(channel, selection.product) }),
    );
  };
}
