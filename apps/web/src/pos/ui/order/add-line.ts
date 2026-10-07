'use client';

import type { Channel, LineSelection, MenuProduct } from '@pos/core';
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

/** Adds a line to the order (RF-C08) through the action queue. */
export function useAddLine(orderId: string, channel: Channel) {
  const run = useRunner();
  return (selection: LineSelection) =>
    run(() => addItem(orderId, { ...selection, product: baseProduct(channel, selection.product) }));
}
