/**
 * Sales by category and product (RF-F01): the valid lines of the closed orders of the period,
 * after their discounts (MWST included). A line has no payment of its own, so this view follows
 * the orders: it matches the Zs except for refunds, orders paid in part and orders paid on another
 * business day, and the report shows that difference instead of hiding it.
 */

export interface ItemSaleLine {
  productId: string | null;
  productName: string;
  categoryId: string | null;
  categoryName: string | null;
  quantity: number;
  /** After discounts, MWST included. */
  lineTotalRappen: number;
}

export interface ItemSalesGroup {
  id: string | null;
  name: string | null;
  quantity: number;
  salesRappen: number;
}

export interface ItemSalesReport {
  salesRappen: number;
  quantity: number;
  byCategory: ItemSalesGroup[];
  byProduct: (ItemSalesGroup & { categoryName: string | null })[];
}

export function itemSalesReport(lines: readonly ItemSaleLine[]): ItemSalesReport {
  const categories = new Map<string | null, ItemSalesGroup>();
  const products = new Map<string, ItemSalesGroup & { categoryName: string | null }>();
  for (const line of lines) {
    const category = categories.get(line.categoryId) ?? {
      id: line.categoryId,
      name: line.categoryName,
      quantity: 0,
      salesRappen: 0,
    };
    category.quantity += line.quantity;
    category.salesRappen += line.lineTotalRappen;
    categories.set(line.categoryId, category);

    // A product without catalog entry is grouped by its name on the receipt.
    const key = line.productId ?? `name:${line.productName}`;
    const product = products.get(key) ?? {
      id: line.productId,
      name: line.productName,
      categoryName: line.categoryName,
      quantity: 0,
      salesRappen: 0,
    };
    product.quantity += line.quantity;
    product.salesRappen += line.lineTotalRappen;
    products.set(key, product);
  }
  const bySales = (a: ItemSalesGroup, b: ItemSalesGroup) =>
    b.salesRappen - a.salesRappen || b.quantity - a.quantity;
  return {
    salesRappen: lines.reduce((total, line) => total + line.lineTotalRappen, 0),
    quantity: lines.reduce((total, line) => total + line.quantity, 0),
    byCategory: [...categories.values()].sort(bySales),
    byProduct: [...products.values()].sort(bySales),
  };
}
