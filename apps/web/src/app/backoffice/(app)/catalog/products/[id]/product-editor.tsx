'use client';

import type { admin, catalog, people } from '@pos/api';
import { Alert } from '@pos/ui/alert';
import { Badge } from '@pos/ui/badge';
import { Button } from '@pos/ui/button';
import { ConfirmButton } from '@pos/ui/confirm';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@pos/ui/tabs';
import { ArrowLeftIcon, CopyIcon, Trash2Icon, TriangleAlertIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { PageHeader } from '@/components/backoffice/page-header';
import { useServerAction } from '@/components/backoffice/use-server-action';
import { deleteProduct, duplicateProduct } from '../../actions';
import { AllergensTab } from './allergens-tab';
import { AvailabilityTab } from './availability-tab';
import { BasicsTab } from './basics-tab';
import {
  EDITOR_TABS,
  type EditorLocation,
  type EditorPermissions,
  type EditorTab,
  type RecipeData,
} from './editor-shared';
import { ModifierGroupsTab } from './modifier-groups-tab';
import { PricesTab } from './prices-tab';
import { RecipeTab } from './recipe-tab';
import { StationsTab } from './stations-tab';
import { TranslationsTab } from './translations-tab';
import { useMoney } from '@/components/money';

/**
 * Panels stay mounted while hidden, so unsaved edits in one tab survive a look at another tab.
 */
const keepMounted = { forceMount: true, className: 'data-[state=inactive]:hidden' } as const;

/** The product sheet: header with status and actions, one tab per part of the product. */
export function ProductEditor({
  product,
  initialTab,
  categories,
  taxCategories,
  modifierGroups,
  locations,
  location,
  stations,
  recipe,
  permissions,
}: {
  product: catalog.ProductDto;
  initialTab: EditorTab;
  categories: catalog.CategoryDto[];
  taxCategories: admin.TaxCategoryDto[];
  modifierGroups: catalog.ModifierGroupDto[];
  locations: { id: string; name: string }[];
  location: EditorLocation | null;
  stations: people.KitchenStationDto[] | null;
  recipe: RecipeData | null;
  permissions: EditorPermissions;
}) {
  const money = useMoney();
  const t = useTranslations('productEditor');
  const tc = useTranslations('common');
  const tp = useTranslations('publication');
  const router = useRouter();
  const [tab, setTab] = useState<EditorTab>(initialTab);

  const changeTab = (value: string) => {
    const next = EDITOR_TABS.find((candidate) => candidate === value) ?? 'basics';
    setTab(next);
    window.history.replaceState(null, '', `?tab=${next}`);
  };

  const duplicate = useServerAction(() => duplicateProduct(product.id), {
    successMessage: t('duplicated'),
    onSuccess: (copy) => router.push(`/backoffice/catalog/products/${copy.id}`),
  });
  const remove = useServerAction(() => deleteProduct(product.id), {
    successMessage: t('deleted'),
    onSuccess: () => router.push('/backoffice/catalog'),
  });

  const category = categories.find((c) => c.id === product.categoryId);
  const issues = product.publication.issues;
  const soldOut = product.locationSettings?.isSoldOut ?? false;

  return (
    <>
      <Link
        href="/backoffice/catalog"
        className="mb-3 inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" /> {t('back')}
      </Link>
      <PageHeader
        nav="products"
        title={product.name}
        description={[category?.name, money.format(product.basePriceRappen)]
          .filter(Boolean)
          .join(' · ')}
        actions={
          permissions.manage ? (
            <>
              <Button
                variant="outline"
                disabled={duplicate.pending}
                onClick={() => void duplicate.run()}
              >
                <CopyIcon /> {t('duplicate')}
              </Button>
              <ConfirmButton
                variant="outline"
                disabled={remove.pending}
                title={t('deleteTitle', { name: product.name })}
                description={t('deleteText')}
                confirmLabel={tc('delete')}
                cancelLabel={tc('cancel')}
                onConfirm={() => remove.run()}
              >
                <Trash2Icon /> {tc('delete')}
              </ConfirmButton>
            </>
          ) : null
        }
      />

      <div className="-mt-3 mb-4 flex flex-wrap gap-1.5">
        {product.isActive ? (
          <Badge variant="success">{tc('active')}</Badge>
        ) : (
          <Badge variant="secondary">{tc('inactive')}</Badge>
        )}
        {product.locationSettings && !product.locationSettings.isActive ? (
          <Badge variant="secondary">{t('inactiveHere')}</Badge>
        ) : null}
        {soldOut ? <Badge variant="destructive">{t('soldOutBadge')}</Badge> : null}
        <Badge variant={product.publishQr && issues.length === 0 ? 'success' : 'outline'}>
          {product.publishQr ? tp('onQr') : tp('notOnQr')}
        </Badge>
        <Badge variant={product.publishWeb && issues.length === 0 ? 'success' : 'outline'}>
          {product.publishWeb ? tp('onWeb') : tp('notOnWeb')}
        </Badge>
        {issues.map((issue) => (
          <Badge key={issue} variant="warning">
            {tp(`issues.${issue}`)}
          </Badge>
        ))}
      </div>

      {permissions.manage ? null : (
        <Alert variant="info" className="mb-4">
          {t('readOnly')}
        </Alert>
      )}

      <Tabs value={tab} onValueChange={changeTab}>
        <TabsList aria-label={t('tabsLabel')}>
          {EDITOR_TABS.filter((value) => value !== 'recipe' || recipe).map((value) => (
            <TabsTrigger key={value} value={value}>
              {t(`tabs.${value}`)}
              {value === 'allergens' && issues.length > 0 ? (
                <TriangleAlertIcon
                  className="size-4 text-warning"
                  aria-label={t('needsAttention')}
                />
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="basics" {...keepMounted}>
          <BasicsTab
            product={product}
            permissions={permissions}
            categories={categories}
            taxCategories={taxCategories}
            onOpenTab={changeTab}
          />
        </TabsContent>
        {recipe ? (
          <TabsContent value="recipe" {...keepMounted}>
            <RecipeTab productName={product.name} recipe={recipe} />
          </TabsContent>
        ) : null}
        <TabsContent value="prices" {...keepMounted}>
          <PricesTab
            product={product}
            permissions={permissions}
            locations={locations}
            location={location}
          />
        </TabsContent>
        <TabsContent value="modifiers" {...keepMounted}>
          <ModifierGroupsTab
            product={product}
            permissions={permissions}
            modifierGroups={modifierGroups}
          />
        </TabsContent>
        <TabsContent value="allergens" {...keepMounted}>
          <AllergensTab product={product} permissions={permissions} />
        </TabsContent>
        <TabsContent value="translations" {...keepMounted}>
          <TranslationsTab product={product} permissions={permissions} location={location} />
        </TabsContent>
        <TabsContent value="availability" {...keepMounted}>
          <AvailabilityTab product={product} permissions={permissions} locations={locations} />
        </TabsContent>
        <TabsContent value="stations" {...keepMounted}>
          <StationsTab
            product={product}
            permissions={permissions}
            location={location}
            stations={stations}
          />
        </TabsContent>
      </Tabs>
    </>
  );
}
