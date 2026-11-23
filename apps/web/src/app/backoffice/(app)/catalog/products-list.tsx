'use client';

import type { catalog } from '@pos/api';
import { Alert } from '@pos/ui/alert';
import { Badge } from '@pos/ui/badge';
import { Button } from '@pos/ui/button';
import { toneByIndex } from '@pos/ui/category-tone';
import { EmptyState } from '@pos/ui/empty-state';
import { Input } from '@pos/ui/input';
import { Label } from '@pos/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@pos/ui/select';
import { Switch } from '@pos/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@pos/ui/table';
import {
  BookOpenCheckIcon,
  BookXIcon,
  PackageXIcon,
  PencilIcon,
  SearchIcon,
  SearchXIcon,
  UtensilsCrossedIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { SoldOutButton } from './sold-out-button';
import type { RecipeState } from '@/components/backoffice/inventory/recipe-state';
import { useMoney } from '@/components/money';

const ALL = 'all';

type Filters = {
  categoryId: string;
  search: string;
  includeInactive: boolean;
  withoutRecipe: boolean;
};

const RECIPE_BADGE = {
  with: { variant: 'success', icon: BookOpenCheckIcon },
  without: { variant: 'warning', icon: BookXIcon },
  noStock: { variant: 'destructive', icon: PackageXIcon },
} as const;

/**
 * Product table with filters in the URL (category, search, inactive), RN-18 publication status and
 * the quick "86" at the current location. With the inventory permission, each dish also shows
 * whether it has its recipe (DEC-051).
 */
export function ProductsList({
  products,
  categories,
  filters,
  atLocation,
  recipes,
  canManage,
  canSoldOut,
}: {
  products: catalog.ProductSummaryDto[];
  categories: catalog.CategoryDto[];
  filters: Filters;
  atLocation: { listed: string[]; soldOut: string[] } | null;
  /** Recipe state per dish; null without the inventory permission. */
  recipes: Record<string, RecipeState> | null;
  canManage: boolean;
  canSoldOut: boolean;
}) {
  const money = useMoney();
  const t = useTranslations('products');
  const tp = useTranslations('publication');
  const tc = useTranslations('common');
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(filters.search);

  const categoryById = new Map(categories.map((category) => [category.id, category]));
  // Each category keeps its colour by its place in the menu (DEC-053).
  const toneOf = (categoryId: string) => {
    const index = categories.findIndex((category) => category.id === categoryId);
    return index < 0 ? 'bg-muted text-muted-foreground' : toneByIndex(index);
  };
  const listed = new Set(atLocation?.listed ?? []);
  const soldOut = new Set(atLocation?.soldOut ?? []);
  const filtered =
    filters.categoryId !== '' ||
    filters.search !== '' ||
    filters.includeInactive ||
    filters.withoutRecipe;

  const apply = (next: Partial<Filters>) => {
    const merged = { ...filters, search, ...next };
    const params = new URLSearchParams();
    if (merged.categoryId) params.set('category', merged.categoryId);
    if (merged.search.trim()) params.set('q', merged.search.trim());
    if (merged.includeInactive) params.set('inactive', '1');
    if (merged.withoutRecipe) params.set('recipe', 'none');
    const query = params.toString();
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname));
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4 shadow-card">
        <div className="grid w-full gap-2 sm:w-56">
          <Label htmlFor="filter-category">{t('category')}</Label>
          <Select
            value={filters.categoryId || ALL}
            onValueChange={(value) => apply({ categoryId: value === ALL ? '' : value })}
          >
            <SelectTrigger id="filter-category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('allCategories')}</SelectItem>
              {categories.map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <form
          role="search"
          className="flex min-w-0 flex-1 items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            apply({ search });
          }}
        >
          <div className="grid min-w-0 flex-1 gap-2">
            <Label htmlFor="filter-search">{tc('search')}</Label>
            <Input
              id="filter-search"
              type="search"
              placeholder={t('searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              icon={<SearchIcon />}
            />
          </div>
          <Button type="submit" variant="secondary" aria-label={tc('search')}>
            {tc('search')}
          </Button>
        </form>
        <div className="flex min-h-11 items-center gap-3">
          <Switch
            id="filter-inactive"
            checked={filters.includeInactive}
            onCheckedChange={(checked) => apply({ includeInactive: checked })}
          />
          <Label htmlFor="filter-inactive">{t('showInactive')}</Label>
        </div>
        {recipes ? (
          <div className="flex min-h-11 items-center gap-3">
            <Switch
              id="filter-recipe"
              checked={filters.withoutRecipe}
              onCheckedChange={(checked) => apply({ withoutRecipe: checked })}
            />
            <Label htmlFor="filter-recipe">{t('recipe.onlyWithout')}</Label>
          </div>
        ) : null}
      </div>

      {atLocation === null ? <Alert variant="info">{t('noLocation')}</Alert> : null}

      <div aria-busy={pending} className={pending ? 'opacity-60 transition-opacity' : undefined}>
        {products.length === 0 ? (
          <EmptyState
            icon={filtered ? <SearchXIcon /> : <UtensilsCrossedIcon />}
            title={filtered ? t('noResults') : t('empty')}
            description={filtered ? t('noResultsHint') : t('emptyHint')}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tc('name')}</TableHead>
                <TableHead>{t('category')}</TableHead>
                <TableHead className="text-right">{t('price')}</TableHead>
                {recipes ? <TableHead>{t('recipe.column')}</TableHead> : null}
                <TableHead>{tc('status')}</TableHead>
                {atLocation ? <TableHead>{t('soldOut')}</TableHead> : null}
                <TableHead className="text-right">{tc('actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((product) => {
                const category = categoryById.get(product.categoryId);
                const isSoldOut = soldOut.has(product.id);
                const inactiveHere =
                  atLocation !== null &&
                  product.isActive &&
                  category?.isActive !== false &&
                  !listed.has(product.id);
                return (
                  <TableRow key={product.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        {product.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element -- any host, no optimizer
                          <img
                            src={product.imageUrl}
                            alt=""
                            className="size-10 shrink-0 rounded-lg border object-cover"
                          />
                        ) : (
                          <span
                            aria-hidden
                            className={`grid size-10 shrink-0 place-items-center rounded-lg text-sm font-semibold ${toneOf(product.categoryId)}`}
                          >
                            {product.name.trim().charAt(0).toUpperCase()}
                          </span>
                        )}
                        <div className="min-w-0">
                          <Link
                            href={`/backoffice/catalog/products/${product.id}`}
                            className="font-medium underline-offset-4 hover:text-brand-strong hover:underline"
                          >
                            {product.name}
                          </Link>
                          {product.sku ? (
                            <div className="font-mono text-[11px] tracking-wide text-muted-foreground">
                              {product.sku}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {category ? (
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${toneOf(product.categoryId)}`}
                        >
                          {category.name}
                        </span>
                      ) : (
                        '—'
                      )}
                      {category && !category.isActive ? (
                        <Badge variant="secondary" className="ml-2">
                          {tc('inactive')}
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right font-medium whitespace-nowrap tabular-nums">
                      {money.format(product.basePriceRappen)}
                    </TableCell>
                    {recipes ? (
                      <TableCell>
                        <RecipeBadge
                          productId={product.id}
                          state={recipes[product.id] ?? 'without'}
                        />
                      </TableCell>
                    ) : null}
                    <TableCell>
                      <div className="flex max-w-xs flex-wrap gap-1">
                        {product.isActive ? (
                          <Badge variant="success" dot>
                            {tc('active')}
                          </Badge>
                        ) : (
                          <Badge variant="secondary" dot>
                            {tc('inactive')}
                          </Badge>
                        )}
                        {inactiveHere ? (
                          <Badge variant="secondary">{t('inactiveHere')}</Badge>
                        ) : null}

                        {product.publication.issues.map((issue) => (
                          <Badge key={issue} variant="warning">
                            {tp(`issues.${issue}`)}
                          </Badge>
                        ))}
                        {!product.publishQr && !product.publishWeb ? (
                          <Badge variant="outline">{tp('notOnQrWeb')}</Badge>
                        ) : !product.publishQr ? (
                          <Badge variant="outline">{tp('notOnQr')}</Badge>
                        ) : !product.publishWeb ? (
                          <Badge variant="outline">{tp('notOnWeb')}</Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    {atLocation ? (
                      <TableCell>
                        {product.isActive && (isSoldOut || listed.has(product.id)) ? (
                          <SoldOutButton
                            productId={product.id}
                            productName={product.name}
                            soldOut={isSoldOut}
                            disabled={!canSoldOut}
                          />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    ) : null}
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" asChild>
                        <Link
                          href={`/backoffice/catalog/products/${product.id}`}
                          aria-label={`${canManage ? tc('edit') : tc('details')}: ${product.name}`}
                        >
                          <PencilIcon />
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

/** The recipe state of a dish; a click opens its "Recipe" tab. */
function RecipeBadge({ productId, state }: { productId: string; state: RecipeState }) {
  const t = useTranslations('products.recipe');
  const { variant, icon: Icon } = RECIPE_BADGE[state];
  const label = { with: t('with'), without: t('without'), noStock: t('noStock') }[state];
  return (
    <Link
      href={`/backoffice/catalog/products/${productId}?tab=recipe`}
      className="inline-flex min-h-11 items-center rounded-lg"
    >
      <Badge variant={variant} className="gap-1 whitespace-nowrap">
        <Icon className="size-3.5" aria-hidden />
        {label}
      </Badge>
    </Link>
  );
}
