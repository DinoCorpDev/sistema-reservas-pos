'use client';

import type { inventory } from '@pos/api';
import { Card, CardDescription, CardHeader, CardTitle } from '@pos/ui/card';
import { BookOpenTextIcon, CornerDownRightIcon, PackageIcon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { RecipeEditor } from '@/components/backoffice/inventory/recipe-editor';
import type { RecipeData } from './editor-shared';

/**
 * What the dish uses, on the dish itself (DEC-051, DEC-053): its recipe, one per variant that
 * needs its own, the stock of each raw material and how many portions are left. Every time the
 * dish goes to the kitchen, these quantities come off the inventory.
 */
export function RecipeTab({ productName, recipe }: { productName: string; recipe: RecipeData }) {
  const t = useTranslations('recipes.inline');
  const [ingredients, setIngredients] = useState<inventory.IngredientDto[]>(recipe.ingredients);
  const added = (ingredient: inventory.IngredientDto) =>
    setIngredients((current) =>
      [...current, ingredient].sort((a, b) => a.name.localeCompare(b.name)),
    );
  const product = recipe.product;

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader
          icon={<BookOpenTextIcon />}
          action={
            <Link
              href="/backoffice/inventory"
              className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <PackageIcon className="size-4" aria-hidden /> {t('toInventory')}
            </Link>
          }
        >
          <CardTitle>{t('title', { name: productName })}</CardTitle>
          <CardDescription>{t('hint')}</CardDescription>
        </CardHeader>
        {product ? (
          <RecipeEditor
            ownerType="product"
            ownerId={product.id}
            ingredients={ingredients}
            initialLines={product.lines}
            onIngredientCreated={added}
          />
        ) : null}
      </Card>

      {product?.variants.map((variant) => (
        <Card key={variant.id}>
          <CardHeader icon={<CornerDownRightIcon />} iconTone="muted">
            <CardTitle>{t('variantTitle', { name: variant.name })}</CardTitle>
            <CardDescription>{t('variantHint')}</CardDescription>
          </CardHeader>
          <RecipeEditor
            ownerType="variant"
            ownerId={variant.id}
            ingredients={ingredients}
            initialLines={variant.lines}
            onIngredientCreated={added}
            emptyHint={t('variantEmpty')}
          />
        </Card>
      ))}
    </div>
  );
}
