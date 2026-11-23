'use client';

import type { inventory } from '@pos/api';
import { type RecipeOwnerType, STOCK_UNITS, type StockUnit } from '@pos/core';
import { Badge } from '@pos/ui/badge';
import { Button } from '@pos/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@pos/ui/dialog';
import { EmptyState } from '@pos/ui/empty-state';
import { Input } from '@pos/ui/input';
import { Field, Label } from '@pos/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@pos/ui/select';
import { cn } from '@pos/ui/utils';
import { BookOpenTextIcon, PackagePlusIcon, PlusIcon, SaveIcon, XIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import * as actions from '@/app/backoffice/(app)/inventory/actions';
import { useServerAction } from '@/components/backoffice/use-server-action';
import {
  draftQuantity,
  type QuantityDraft,
  quantityDraft,
  QuantityInput,
  useQuantity,
} from './quantity';
import { portionsLeft } from './recipe-state';

type Ingredient = inventory.IngredientDto;
type Line = inventory.RecipeLineDto;
type LineDraft = { ingredientId: string; quantity: QuantityDraft };

/**
 * The recipe of one dish, variant or option, edited where the dish is (DEC-051, DEC-053): each
 * raw material with its quantity and current stock, how many portions the stock still allows,
 * and a raw material that does not exist yet created on the spot, without leaving the screen.
 */
export function RecipeEditor({
  ownerType,
  ownerId,
  ingredients,
  initialLines,
  onIngredientCreated,
  emptyHint,
  canEdit = true,
}: {
  ownerType: RecipeOwnerType;
  ownerId: string;
  ingredients: Ingredient[];
  initialLines: Line[];
  /** A raw material created here, so the other recipes on the page can use it too. */
  onIngredientCreated: (ingredient: Ingredient) => void;
  emptyHint?: string;
  canEdit?: boolean;
}) {
  const t = useTranslations('recipes');
  const ti = useTranslations('inventory');
  const tc = useTranslations('common');
  const format = useQuantity();
  const byId = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);
  const toDrafts = (lines: Line[]): LineDraft[] =>
    lines.map((line) => ({
      ingredientId: line.ingredientId,
      quantity: quantityDraft(line.quantity, byId.get(line.ingredientId)?.unit ?? 'g'),
    }));
  const [saved, setSaved] = useState<Line[]>(initialLines);
  const [lines, setLines] = useState<LineDraft[]>(() => toDrafts(initialLines));
  const [invalid, setInvalid] = useState<'quantity' | 'ingredient' | null>(null);
  const [creatingFor, setCreatingFor] = useState<number | null>(null);

  const save = useServerAction(
    (next: Line[]) => actions.replaceRecipe(ownerType, ownerId, { lines: next }),
    { successMessage: t('saved'), onSuccess: (result) => setSaved(result) },
  );

  // What is typed, as base units; null while a quantity is missing or not a number.
  const parsed: Line[] | null = (() => {
    const out: Line[] = [];
    for (const line of lines) {
      if (!line.ingredientId) continue;
      const unit = byId.get(line.ingredientId)?.unit ?? 'g';
      const quantity = draftQuantity(line.quantity, unit);
      if (quantity === undefined || quantity === null || quantity <= 0) return null;
      out.push({ ingredientId: line.ingredientId, quantity });
    }
    return out;
  })();
  const dirty =
    parsed === null ||
    JSON.stringify(parsed) !== JSON.stringify(saved) ||
    lines.some((l) => !l.ingredientId);
  const portions = parsed && parsed.length > 0 ? portionsLeft(parsed, byId) : null;
  const usable = ingredients.filter((i) => i.isActive);
  const taken = new Set(lines.map((l) => l.ingredientId));

  // A new line starts on the first raw material the recipe does not use yet.
  const blankLine = (current: LineDraft[]): LineDraft => {
    const used = new Set(current.map((l) => l.ingredientId));
    const next = usable.find((i) => !used.has(i.id));
    return { ingredientId: next?.id ?? '', quantity: quantityDraft(null, next?.unit ?? 'g') };
  };

  const update = (index: number, patch: Partial<LineDraft>) => {
    setInvalid(null);
    setLines((current) => current.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  };

  return (
    <div className="grid gap-4">
      {lines.length === 0 ? (
        <EmptyState
          compact
          icon={<BookOpenTextIcon />}
          title={t('inline.emptyTitle')}
          description={emptyHint ?? t('inline.emptyHint')}
          action={
            canEdit ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={usable.length === 0}
                  onClick={() => setLines([blankLine([])])}
                >
                  <PlusIcon /> {t('addLine')}
                </Button>
                <Button type="button" variant="outline" onClick={() => setCreatingFor(-1)}>
                  <PackagePlusIcon /> {t('inline.newIngredient')}
                </Button>
              </>
            ) : null
          }
        />
      ) : (
        <ul className="grid gap-2">
          {lines.map((line, index) => {
            const ingredient = byId.get(line.ingredientId);
            const unit = ingredient?.unit ?? 'g';
            return (
              <li
                key={index}
                className="grid gap-2 rounded-xl border bg-surface-2 p-3 sm:grid-cols-[minmax(0,1fr)_15rem_auto] sm:items-end"
              >
                <div className="grid gap-1.5">
                  <Label htmlFor={`${ownerId}-line-${index}`}>{t('ingredient')}</Label>
                  <Select
                    value={line.ingredientId}
                    disabled={!canEdit}
                    onValueChange={(ingredientId) => {
                      if (ingredientId === '__new__') {
                        setCreatingFor(index);
                        return;
                      }
                      const next = byId.get(ingredientId)?.unit ?? 'g';
                      update(index, {
                        ingredientId,
                        quantity: next === unit ? line.quantity : quantityDraft(null, next),
                      });
                    }}
                  >
                    <SelectTrigger id={`${ownerId}-line-${index}`}>
                      <SelectValue placeholder={t('chooseIngredient')} />
                    </SelectTrigger>
                    <SelectContent>
                      {usable
                        .filter((i) => i.id === line.ingredientId || !taken.has(i.id))
                        .map((i) => (
                          <SelectItem key={i.id} value={i.id}>
                            {i.name}
                            {i.onHand !== null ? (
                              <span className="ml-2 text-xs text-muted-foreground">
                                {format(i.onHand, i.unit)}
                              </span>
                            ) : null}
                          </SelectItem>
                        ))}
                      <SelectItem value="__new__" className="font-medium text-brand-strong">
                        + {t('inline.newIngredient')}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  {ingredient && ingredient.onHand !== null ? (
                    <span
                      className={cn(
                        'text-xs',
                        ingredient.isLow ? 'text-destructive' : 'text-muted-foreground',
                      )}
                    >
                      {t('inline.inStock', {
                        quantity: format(ingredient.onHand, ingredient.unit),
                      })}
                    </span>
                  ) : null}
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`${ownerId}-qty-${index}`}>{t('inline.perPortion')}</Label>
                  <QuantityInput
                    id={`${ownerId}-qty-${index}`}
                    unit={unit}
                    value={line.quantity}
                    onChange={(quantity) => update(index, { quantity })}
                  />
                </div>
                {canEdit ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t('removeLine')}
                    onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
                  >
                    <XIcon />
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {invalid ? (
        <p className="text-sm text-destructive" role="alert">
          {invalid === 'ingredient' ? t('inline.missingIngredient') : ti('invalidQuantity')}
        </p>
      ) : null}

      {lines.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {canEdit ? (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={lines.length >= usable.length}
                onClick={() => setLines((current) => [...current, blankLine(current)])}
              >
                <PlusIcon /> {t('addLine')}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setCreatingFor(-1)}>
                <PackagePlusIcon /> {t('inline.newIngredient')}
              </Button>
            </>
          ) : null}
          <span className="ml-auto flex flex-wrap items-center gap-2">
            {portions !== null ? (
              <Badge variant={portions === 0 ? 'destructive' : 'success'} dot>
                {portions === 0
                  ? t('inline.noPortions')
                  : t('inline.portions', { count: portions })}
              </Badge>
            ) : null}
            {canEdit ? (
              <Button
                type="button"
                disabled={!dirty || save.pending}
                onClick={() => {
                  // A line without its raw material is never dropped in silence.
                  if (lines.some((l) => !l.ingredientId)) {
                    setInvalid('ingredient');
                    return;
                  }
                  if (parsed === null) {
                    setInvalid('quantity');
                    return;
                  }
                  void save.run(parsed);
                }}
              >
                <SaveIcon /> {save.pending ? tc('saving') : t('inline.save')}
              </Button>
            ) : null}
          </span>
        </div>
      ) : saved.length > 0 && canEdit ? (
        // Every line removed: saving clears the recipe.
        <div className="flex justify-end">
          <Button type="button" disabled={save.pending} onClick={() => void save.run([])}>
            <SaveIcon /> {t('inline.save')}
          </Button>
        </div>
      ) : null}

      <NewIngredientDialog
        open={creatingFor !== null}
        onClose={() => setCreatingFor(null)}
        onCreated={(ingredient) => {
          onIngredientCreated(ingredient);
          const draft = {
            ingredientId: ingredient.id,
            quantity: quantityDraft(null, ingredient.unit),
          };
          setLines((current) =>
            creatingFor !== null && creatingFor >= 0
              ? current.map((l, i) => (i === creatingFor ? draft : l))
              : [...current, draft],
          );
          setCreatingFor(null);
        }}
      />
    </div>
  );
}

/** A raw material created from a recipe: name, how it is measured, when to warn. */
function NewIngredientDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (ingredient: Ingredient) => void;
}) {
  const t = useTranslations('recipes.inline');
  const ti = useTranslations('inventory');
  const tc = useTranslations('common');
  const [name, setName] = useState('');
  const [unit, setUnit] = useState<StockUnit>('g');
  const [threshold, setThreshold] = useState<QuantityDraft>(quantityDraft(null, 'g'));
  const [invalid, setInvalid] = useState(false);
  const create = useServerAction(
    (input: { name: string; unit: StockUnit; lowStockThreshold: number | null }) =>
      actions.createIngredient(input),
    {
      successMessage: ti('saved'),
      onSuccess: (ingredient) => {
        onCreated(ingredient);
        setName('');
        setThreshold(quantityDraft(null, unit));
      },
    },
  );

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent closeLabel={tc('close')}>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const lowStockThreshold = draftQuantity(threshold, unit);
            if (!name.trim() || lowStockThreshold === undefined) {
              setInvalid(true);
              return;
            }
            void create.run({ name: name.trim(), unit, lowStockThreshold });
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('newIngredientTitle')}</DialogTitle>
            <DialogDescription>{t('newIngredientHint')}</DialogDescription>
          </DialogHeader>
          <Field label={tc('name')} htmlFor="new-ingredient-name">
            <Input
              id="new-ingredient-name"
              autoFocus
              value={name}
              placeholder={t('namePlaceholder')}
              onChange={(event) => {
                setInvalid(false);
                setName(event.target.value);
              }}
            />
          </Field>
          <Field label={ti('unit')} htmlFor="new-ingredient-unit" hint={ti('unitFixed')}>
            <Select
              value={unit}
              onValueChange={(value) => {
                setUnit(value as StockUnit);
                setThreshold(quantityDraft(null, value as StockUnit));
              }}
            >
              <SelectTrigger id="new-ingredient-unit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STOCK_UNITS.map((u) => (
                  <SelectItem key={u} value={u}>
                    {ti(`units.${u}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field
            label={ti('threshold')}
            htmlFor="new-ingredient-threshold"
            hint={ti('thresholdHint')}
          >
            <QuantityInput
              id="new-ingredient-threshold"
              unit={unit}
              value={threshold}
              onChange={(value) => {
                setInvalid(false);
                setThreshold(value);
              }}
            />
          </Field>
          {invalid ? (
            <p className="text-sm text-destructive" role="alert">
              {ti('invalidQuantity')}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {tc('cancel')}
            </Button>
            <Button type="submit" disabled={create.pending}>
              <PackagePlusIcon /> {t('create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
