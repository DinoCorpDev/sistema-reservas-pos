'use client';

import { type Channel, isContentLanguage, type MenuProduct } from '@pos/core';
import { formatPosMoney } from '@/pos/money';
import { Button } from '@pos/ui/button';
import { solidByIndex } from '@pos/ui/category-tone';
import { EmptyState } from '@pos/ui/empty-state';
import { cn } from '@pos/ui/utils';
import { Input } from '@pos/ui/input';
import { Search, SearchX, SlidersHorizontal, UtensilsCrossed, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { menuFor } from '../../catalog';
import { usePos } from '@/device/store';
import { needsChoice, useAddLine } from './add-line';
import { courseOf } from './format';
import { useNow } from './hooks';
import { ProductDialog } from './product-dialog';

/** Lower case without accents: "rosti" finds "Rösti". */
const searchable = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/**
 * Categories and big product buttons (RF-C08, RNF-22): one tap adds a simple product with its
 * default course; products with variants or required options open a dialog. What cannot be
 * ordered right now stays visible but disabled, with the reason ("86" when sold out, RN-17).
 */
export function ProductPanel({
  orderId,
  channel,
  counts,
  className,
}: {
  orderId: string;
  channel: Channel;
  /** Quantity of each product already in the order, shown on its button. */
  counts?: ReadonlyMap<string, number>;
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
  /** null: categories; a string: searching the whole menu. */
  const [query, setQuery] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const addLine = useAddLine(orderId, channel);

  const categories = menu?.categories ?? [];
  // Each category keeps its colour by its place in the menu, as in the backoffice (DEC-053).
  const toneOf = new Map<string, string>();
  categories.forEach((entry, index) => {
    for (const product of entry.products) toneOf.set(product.id, solidByIndex(index));
  });
  const category = categories.find((entry) => entry.id === categoryId) ?? categories[0];
  const needle = query === null ? '' : searchable(query.trim());
  const products = needle
    ? [
        ...new Map(
          categories
            .flatMap((entry) => entry.products)
            .filter((product) => searchable(product.name).includes(needle))
            .map((product) => [product.id, product]),
        ).values(),
      ]
    : (category?.products ?? []);

  /** The tap landed: a short flash on the button and, on a phone, a tick of vibration. */
  function acknowledge(productId: string) {
    setFlashId(productId);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashId(null), 350);
    if (typeof navigator !== 'undefined') navigator.vibrate?.(15);
  }

  function tap(product: MenuProduct) {
    if (needsChoice(product)) {
      setDialogProduct(product);
      return;
    }
    acknowledge(product.id);
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
      {query !== null ? (
        <div className="flex shrink-0 items-center gap-2 border-b p-2">
          <Search className="ml-1 size-5 shrink-0 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => event.key === 'Escape' && setQuery(null)}
            placeholder={t('searchPlaceholder')}
            aria-label={t('search')}
            enterKeyHint="search"
            className="h-11 text-base"
          />
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('closeSearch')}
            onClick={() => setQuery(null)}
          >
            <X />
          </Button>
        </div>
      ) : (
        <nav
          className="flex shrink-0 gap-2 overflow-x-auto border-b p-2 [scrollbar-width:none] lg:flex-wrap"
          aria-label={t('categories')}
        >
          <Button
            variant="outline"
            size="icon"
            className="shrink-0"
            aria-label={t('search')}
            onClick={() => setQuery('')}
          >
            <Search />
          </Button>
          {categories.map((entry, index) => {
            const active = entry.id === category?.id;
            return (
              <Button
                key={entry.id}
                variant={active ? 'default' : 'outline'}
                className="shrink-0 rounded-full pl-3"
                aria-pressed={active}
                onClick={() => setCategoryId(entry.id)}
              >
                <span
                  aria-hidden
                  className={cn(
                    'size-2.5 shrink-0 rounded-full',
                    solidByIndex(index),
                    active && 'ring-2 ring-white/70',
                  )}
                />
                {entry.name}
              </Button>
            );
          })}
        </nav>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {!category ? (
          <EmptyState icon={<UtensilsCrossed />} title={t('empty')} className="m-2" />
        ) : products.length === 0 ? (
          <EmptyState icon={<SearchX />} title={t('noMatch')} className="m-2" />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2.5">
            {products.map((product) => {
              const options =
                product.orderable && !needsChoice(product) && product.modifierGroups.length > 0;
              const count = counts?.get(product.id) ?? 0;
              return (
                <div key={product.id} className="relative">
                  <Button
                    variant="outline"
                    size="pos"
                    data-testid="product"
                    data-product-id={product.id}
                    disabled={!product.orderable}
                    onClick={() => tap(product)}
                    className={cn(
                      'relative h-full w-full items-stretch justify-between gap-1.5 overflow-hidden rounded-xl pt-3.5 text-left whitespace-normal shadow-card transition-[transform,box-shadow] duration-150 hover:shadow-raised',
                      count > 0 && 'border-primary/50 bg-primary/5',
                      flashId === product.id && 'scale-[0.97] ring-2 ring-primary',
                    )}
                  >
                    {/* The category's colour, as a stripe along the top. */}
                    <span
                      aria-hidden
                      className={cn(
                        'absolute inset-x-0 top-0 h-1.5',
                        toneOf.get(product.id) ?? 'bg-muted',
                      )}
                    />
                    {product.imageUrl ? (
                      // Online only: offline the image fails and hides, the stripe stays.
                      // eslint-disable-next-line @next/next/no-img-element -- any host, works offline-first
                      <img
                        src={product.imageUrl}
                        alt=""
                        loading="lazy"
                        className="h-16 w-full rounded-md object-cover"
                        onError={(event) => {
                          event.currentTarget.style.display = 'none';
                        }}
                      />
                    ) : null}
                    <span className="line-clamp-3 font-semibold">{product.name}</span>
                    <span className={cn('text-base font-bold tabular-nums', options && 'pr-10')}>
                      {formatPosMoney(product.priceRappen)}
                    </span>
                    {product.reason && (
                      <span className="text-xs font-semibold text-destructive">
                        {tu(product.reason)}
                      </span>
                    )}
                  </Button>
                  {count > 0 && (
                    <span
                      className="pointer-events-none absolute -top-1.5 -right-1.5 flex h-7 min-w-7 items-center justify-center rounded-full bg-primary px-1.5 text-sm font-bold text-primary-foreground tabular-nums shadow-sm ring-2 ring-background"
                      data-testid="product-count"
                    >
                      ×{count}
                    </span>
                  )}
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
