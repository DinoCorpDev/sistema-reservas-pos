'use client';

import type { inventory } from '@pos/api';
import type { RecipeOwnerType } from '@pos/core';
import { Alert } from '@pos/ui/alert';
import { Badge } from '@pos/ui/badge';
import { Button } from '@pos/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@pos/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@pos/ui/dialog';
import { Input } from '@pos/ui/input';
import { Label } from '@pos/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@pos/ui/select';
import { Switch } from '@pos/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@pos/ui/table';
import { CornerDownRightIcon, PencilIcon, PlusIcon, XIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import {
  draftQuantity,
  type QuantityDraft,
  quantityDraft,
  QuantityInput,
  useQuantity,
} from '@/components/backoffice/inventory/quantity';
import { useServerAction } from '@/components/backoffice/use-server-action';
import * as actions from '../actions';

type Ingredient = inventory.IngredientDto;
type Line = inventory.RecipeLineDto;

interface Editing {
  ownerType: RecipeOwnerType;
  ownerId: string;
  name: string;
  lines: { ingredientId: string; quantity: QuantityDraft }[];
}

/** The recipe of every product, variant and modifier option, each editable in a dialog. */
export function RecipesManager({
  recipes,
  ingredients,
}: {
  recipes: inventory.RecipesDto;
  ingredients: Ingredient[];
}) {
  const t = useTranslations('recipes');
  const tc = useTranslations('common');
  const tInventory = useTranslations('inventory');
  const format = useQuantity();
  const [query, setQuery] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [invalid, setInvalid] = useState(false);
  const byId = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);

  const save = useServerAction(
    (value: Editing, lines: Line[]) =>
      actions.replaceRecipe(value.ownerType, value.ownerId, { lines }),
    { successMessage: t('saved'), onSuccess: () => setEditing(null) },
  );

  const summary = (lines: Line[]) =>
    lines
      .map((line) => {
        const ingredient = byId.get(line.ingredientId);
        return ingredient ? `${ingredient.name} ${format(line.quantity, ingredient.unit)}` : null;
      })
      .filter(Boolean)
      .join(' · ');

  const open = (ownerType: RecipeOwnerType, owner: inventory.RecipeOwnerDto, name: string) => {
    setInvalid(false);
    setEditing({
      ownerType,
      ownerId: owner.id,
      name,
      lines: owner.lines.map((line) => ({
        ingredientId: line.ingredientId,
        quantity: quantityDraft(line.quantity, byId.get(line.ingredientId)?.unit ?? 'g'),
      })),
    });
  };

  const missingCount = recipes.products.filter((p) => p.isActive && p.lines.length === 0).length;
  const needle = query.trim().toLowerCase();
  const products = recipes.products.filter(
    (p) =>
      (!needle ||
        p.name.toLowerCase().includes(needle) ||
        p.categoryName.toLowerCase().includes(needle)) &&
      (!onlyMissing || p.lines.length === 0),
  );

  const recipeCell = (lines: Line[], fallback: string) =>
    lines.length > 0 ? (
      <span>{summary(lines)}</span>
    ) : (
      <span className="text-muted-foreground">{fallback}</span>
    );

  const editButton = (
    ownerType: RecipeOwnerType,
    owner: inventory.RecipeOwnerDto,
    name: string,
  ) => (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`${t('edit')}: ${name}`}
      onClick={() => open(ownerType, owner, name)}
    >
      <PencilIcon />
    </Button>
  );

  const usable = ingredients.filter((i) => i.isActive);

  return (
    <div className="grid gap-6">
      {ingredients.length === 0 ? <Alert variant="info">{t('noIngredients')}</Alert> : null}
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <div className="grid gap-1">
            <CardTitle>{t('products')}</CardTitle>
            <CardDescription>{t('productsHint')}</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {missingCount > 0 ? (
              <Badge variant="warning">{t('missing', { count: missingCount })}</Badge>
            ) : null}
            <div className="flex items-center gap-2">
              <Switch id="only-missing" checked={onlyMissing} onCheckedChange={setOnlyMissing} />
              <Label htmlFor="only-missing">{t('onlyMissing')}</Label>
            </div>
            <Input
              className="w-56"
              value={query}
              placeholder={t('search')}
              aria-label={t('search')}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </CardHeader>
        {products.length === 0 ? (
          <p className="text-muted-foreground">{t('empty')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tc('name')}</TableHead>
                <TableHead>{t('title')}</TableHead>
                <TableHead className="text-right">{tc('actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.flatMap((product) => [
                <TableRow key={product.id} data-testid={`recipe-${product.name}`}>
                  <TableCell>
                    <span className="font-medium">{product.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {product.categoryName}
                    </span>
                  </TableCell>
                  <TableCell>{recipeCell(product.lines, t('noRecipe'))}</TableCell>
                  <TableCell className="text-right">
                    {editButton('product', product, product.name)}
                  </TableCell>
                </TableRow>,
                ...product.variants.map((variant) => (
                  <TableRow key={variant.id}>
                    <TableCell>
                      <span className="flex items-center gap-2 pl-4">
                        <CornerDownRightIcon className="size-4 text-muted-foreground" aria-hidden />
                        {variant.name}
                      </span>
                    </TableCell>
                    <TableCell>{recipeCell(variant.lines, t('usesProduct'))}</TableCell>
                    <TableCell className="text-right">
                      {editButton('variant', variant, `${product.name} · ${variant.name}`)}
                    </TableCell>
                  </TableRow>
                )),
              ])}
            </TableBody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('modifiers')}</CardTitle>
          <CardDescription>{t('modifiersHint')}</CardDescription>
        </CardHeader>
        {recipes.modifiers.length === 0 ? (
          <p className="text-muted-foreground">{t('noModifiers')}</p>
        ) : (
          <Table>
            <TableBody>
              {recipes.modifiers.map((modifier) => (
                <TableRow key={modifier.id}>
                  <TableCell>
                    <span className="font-medium">{modifier.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {modifier.groupName}
                    </span>
                  </TableCell>
                  <TableCell>{recipeCell(modifier.lines, t('noRecipe'))}</TableCell>
                  <TableCell className="text-right">
                    {editButton('modifier', modifier, modifier.name)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Dialog open={!!editing} onOpenChange={(isOpen) => !isOpen && setEditing(null)}>
        <DialogContent closeLabel={tc('close')} className="sm:max-w-xl">
          {editing ? (
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                const lines: Line[] = [];
                for (const line of editing.lines) {
                  if (!line.ingredientId) continue;
                  const unit = byId.get(line.ingredientId)?.unit ?? 'g';
                  const quantity = draftQuantity(line.quantity, unit);
                  if (quantity === undefined || quantity === null || quantity <= 0) {
                    setInvalid(true);
                    return;
                  }
                  lines.push({ ingredientId: line.ingredientId, quantity });
                }
                void save.run(editing, lines);
              }}
            >
              <DialogHeader>
                <DialogTitle>{t('dialogTitle', { name: editing.name })}</DialogTitle>
                <DialogDescription>{t('dialogHint')}</DialogDescription>
              </DialogHeader>
              {editing.lines.map((line, index) => {
                const unit = byId.get(line.ingredientId)?.unit ?? 'g';
                const taken = new Set(editing.lines.map((l) => l.ingredientId));
                const update = (patch: Partial<Editing['lines'][number]>) =>
                  setEditing({
                    ...editing,
                    lines: editing.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)),
                  });
                return (
                  <div
                    key={index}
                    className="grid gap-2 sm:grid-cols-[1fr_14rem_auto] sm:items-end"
                  >
                    <div className="grid gap-2">
                      <Label htmlFor={`line-${index}`}>{t('ingredient')}</Label>
                      <Select
                        value={line.ingredientId}
                        onValueChange={(ingredientId) => {
                          const next = byId.get(ingredientId)?.unit ?? 'g';
                          update({
                            ingredientId,
                            quantity: next === unit ? line.quantity : quantityDraft(null, next),
                          });
                        }}
                      >
                        <SelectTrigger id={`line-${index}`}>
                          <SelectValue placeholder={t('chooseIngredient')} />
                        </SelectTrigger>
                        <SelectContent>
                          {usable
                            .filter((i) => i.id === line.ingredientId || !taken.has(i.id))
                            .map((i) => (
                              <SelectItem key={i.id} value={i.id}>
                                {i.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor={`qty-${index}`}>{t('quantity')}</Label>
                      <QuantityInput
                        id={`qty-${index}`}
                        unit={unit}
                        value={line.quantity}
                        onChange={(quantity) => {
                          setInvalid(false);
                          update({ quantity });
                        }}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t('removeLine')}
                      onClick={() =>
                        setEditing({
                          ...editing,
                          lines: editing.lines.filter((_, i) => i !== index),
                        })
                      }
                    >
                      <XIcon />
                    </Button>
                  </div>
                );
              })}
              {invalid ? (
                <p className="text-sm text-destructive" role="alert">
                  {tInventory('invalidQuantity')}
                </p>
              ) : null}
              <div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={usable.length === 0 || editing.lines.length >= usable.length}
                  onClick={() =>
                    setEditing({
                      ...editing,
                      lines: [
                        ...editing.lines,
                        { ingredientId: '', quantity: quantityDraft(null, 'g') },
                      ],
                    })
                  }
                >
                  <PlusIcon /> {t('addLine')}
                </Button>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                  {tc('cancel')}
                </Button>
                <Button type="submit" disabled={save.pending}>
                  {save.pending ? tc('saving') : tc('save')}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
