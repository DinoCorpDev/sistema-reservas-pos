'use client';

import { type Channel, formatChf, isContentLanguage, type MenuProduct } from '@pos/core';
import { Button } from '@pos/ui/button';
import { cn } from '@pos/ui/utils';
import { SlidersHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { menuFor } from '../../catalog';
import { usePos } from '../../store';
import { needsChoice, useAddLine } from './add-line';
import { courseOf } from './format';
import { useNow } from './hooks';
import { ProductDialog } from './product-dialog';

/**
 * Categories and big product buttons (RF-C08, RNF-22): one tap adds a simple product with its
 * default course; products with variants or required options open a dialog. What cannot be
 * ordered right now stays visible but disabled, with the reason ("86" when sold out, RN-17).
 */
export function ProductPanel({
  orderId,
  channel,
  className,
}: {
  orderId: string;
  channel: Channel;
  className?: string;
}) {
  const t = useTranslations('posOrder.menu');
  const tu = useTranslations('posOrder.unavailable');
  const language = usePos((state) => state.user?.uiLanguage);
  // Availability windows (RN-17) are re-evaluated while the screen stays open.
  useNow(60_000);
  const menu = menuFor(channel, isContentLanguage(language) ? language : undefined);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [dialogProduct, setDialogProduct] = useState<MenuProduct | null>(null);
  const addLine = useAddLine(orderId, channel);

  const categories = menu?.categories ?? [];
  const category = categories.find((entry) => entry.id === categoryId) ?? categories[0];

  function tap(product: MenuProduct) {
    if (needsChoice(product)) {
      setDialogProduct(product);
      return;
    }
    void addLine({
      product,
      variantId: null,
      modifiers: [],
      quantity: 1,
      note: null,
      seat: null,
      course: courseOf(product),
    });
  }

  return (
    <section className={cn('flex min-h-0 flex-col', className)} aria-label={t('title')}>
      <nav
        className="flex shrink-0 gap-2 overflow-x-auto border-b p-2 lg:flex-wrap"
        aria-label={t('categories')}
      >
        {categories.map((entry) => {
          const active = entry.id === category?.id;
          return (
            <Button
              key={entry.id}
              variant={active ? 'default' : 'outline'}
              aria-pressed={active}
              onClick={() => setCategoryId(entry.id)}
            >
              {entry.name}
            </Button>
          );
        })}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {!category ? (
          <p className="p-6 text-center text-muted-foreground">{t('empty')}</p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2">
            {category.products.map((product) => {
              const options =
                product.orderable && !needsChoice(product) && product.modifierGroups.length > 0;
              return (
                <div key={product.id} className="relative">
                  <Button
                    variant="outline"
                    size="pos"
                    data-testid="product"
                    data-product-id={product.id}
                    disabled={!product.orderable}
                    onClick={() => tap(product)}
                    className="h-full w-full items-stretch justify-between gap-1 text-left whitespace-normal"
                  >
                    <span className="line-clamp-3 font-semibold">{product.name}</span>
                    <span
                      className={cn(
                        'text-sm text-muted-foreground tabular-nums',
                        options && 'pr-10',
                      )}
                    >
                      {formatChf(product.priceRappen)}
                    </span>
                    {product.reason && (
                      <span className="text-xs font-semibold text-destructive">
                        {tu(product.reason)}
                      </span>
                    )}
                  </Button>
                  {options && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('options')}
                      className="absolute right-0.5 bottom-0.5"
                      onClick={() => setDialogProduct(product)}
                    >
                      <SlidersHorizontal />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <ProductDialog
        product={dialogProduct}
        orderId={orderId}
        channel={channel}
        onClose={() => setDialogProduct(null)}
      />
    </section>
  );
}
