'use client';

import type { catalog } from '@pos/api';
import { Alert } from '@pos/ui/alert';
import { Badge } from '@pos/ui/badge';
import { Button } from '@pos/ui/button';
import { Input } from '@pos/ui/input';
import { Label } from '@pos/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@pos/ui/select';
import { Switch } from '@pos/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@pos/ui/table';
import { PencilIcon, SearchIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { SoldOutButton } from './sold-out-button';
import { useMoney } from '@/components/money';

const ALL = 'all';

type Filters = { categoryId: string; search: string; includeInactive: boolean };

/**
 * Product table with filters in the URL (category, search, inactive), RN-18 publication status and
 * the quick "86" at the current location.
 */
export function ProductsList({
  products,
  categories,
  filters,
  atLocation,
  canManage,
  canSoldOut,
}: {
  products: catalog.ProductSummaryDto[];
  categories: catalog.CategoryDto[];
  filters: Filters;
  atLocation: { listed: string[]; soldOut: string[] } | null;
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
  const listed = new Set(atLocation?.listed ?? []);
  const soldOut = new Set(atLocation?.soldOut ?? []);
  const filtered = filters.categoryId !== '' || filters.search !== '' || filters.includeInactive;

  const apply = (next: Partial<Filters>) => {
    const merged = { ...filters, search, ...next };
    const params = new URLSearchParams();
    if (merged.categoryId) params.set('category', merged.categoryId);
    if (merged.search.trim()) params.set('q', merged.search.trim());
    if (merged.includeInactive) params.set('inactive', '1');
    const query = params.toString();
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname));
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
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
            />
          </div>
          <Button type="submit" variant="outline" size="icon" aria-label={tc('search')}>
            <SearchIcon />
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
      </div>

      {atLocation === null ? <Alert variant="info">{t('noLocation')}</Alert> : null}

      <div aria-busy={pending} className={pending ? 'opacity-60 transition-opacity' : undefined}>
        {products.length === 0 ? (
          <p className="rounded-xl border p-6 text-muted-foreground">
            {filtered ? t('noResults') : t('empty')}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tc('name')}</TableHead>
                <TableHead>{t('category')}</TableHead>
                <TableHead className="text-right">{t('price')}</TableHead>
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
                      <Link
                        href={`/backoffice/catalog/products/${product.id}`}
                        className="font-medium hover:underline"
                      >
                        {product.name}
                      </Link>
                      {product.sku ? (
                        <div className="font-mono text-xs text-muted-foreground">{product.sku}</div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {category?.name ?? '—'}
                      {category && !category.isActive ? (
                        <Badge variant="secondary" className="ml-2">
                          {tc('inactive')}
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap tabular-nums">
                      {money.format(product.basePriceRappen)}
                    </TableCell>
                    <TableCell>
                      <div className="flex max-w-xs flex-wrap gap-1">
                        {product.isActive ? (
                          <Badge variant="success">{tc('active')}</Badge>
                        ) : (
                          <Badge variant="secondary">{tc('inactive')}</Badge>
                        )}
                        {inactiveHere ? (
                          <Badge variant="secondary">{t('inactiveHere')}</Badge>
                        ) : null}
                        {isSoldOut ? (
                          <Badge variant="destructive">{t('soldOutBadge')}</Badge>
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
