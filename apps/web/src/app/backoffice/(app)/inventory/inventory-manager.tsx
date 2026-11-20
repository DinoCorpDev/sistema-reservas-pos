'use client';

import type { inventory } from '@pos/api';
import { MOVEMENT_KINDS, type MovementKind, STOCK_UNITS, type StockUnit } from '@pos/core';
import { Badge } from '@pos/ui/badge';
import { Button } from '@pos/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@pos/ui/card';
import { ConfirmButton } from '@pos/ui/confirm';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@pos/ui/dialog';
import { Input } from '@pos/ui/input';
import { Field, Label } from '@pos/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@pos/ui/select';
import { Switch } from '@pos/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@pos/ui/table';
import { cn } from '@pos/ui/utils';
import {
  ClipboardCheckIcon,
  HistoryIcon,
  PencilIcon,
  PlusIcon,
  ShoppingCartIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  draftQuantity,
  type QuantityDraft,
  quantityDraft,
  QuantityInput,
  useQuantity,
} from '@/components/backoffice/inventory/quantity';
import { useServerAction } from '@/components/backoffice/use-server-action';
import * as actions from './actions';

type Ingredient = inventory.IngredientDto;

interface IngredientDraft {
  id?: string;
  name: string;
  unit: StockUnit;
  threshold: QuantityDraft;
  isActive: boolean;
}

interface MovementDraft {
  ingredient: Ingredient;
  kind: MovementKind;
  quantity: QuantityDraft;
  note: string;
}

/** Raw materials with their stock, their alert level and the movements by hand (DEC-051). */
export function InventoryManager({
  ingredients,
  hasLocation,
}: {
  ingredients: Ingredient[];
  hasLocation: boolean;
}) {
  const t = useTranslations('inventory');
  const tc = useTranslations('common');
  const format = useQuantity();
  const [draft, setDraft] = useState<IngredientDraft | null>(null);
  const [movement, setMovement] = useState<MovementDraft | null>(null);
  const [invalid, setInvalid] = useState(false);

  const save = useServerAction(
    (value: IngredientDraft) => {
      const lowStockThreshold = draftQuantity(value.threshold, value.unit) ?? null;
      const body = { name: value.name.trim(), lowStockThreshold, isActive: value.isActive };
      return value.id
        ? actions.updateIngredient(value.id, body)
        : actions.createIngredient({ ...body, unit: value.unit });
    },
    { successMessage: t('saved'), onSuccess: () => setDraft(null) },
  );
  const record = useServerAction(
    (id: string, body: { kind: MovementKind; quantity: number; note: string | null }) =>
      actions.recordMovement(id, body),
    { successMessage: t('movement.recorded'), onSuccess: () => setMovement(null) },
  );
  const toggle = useServerAction((id: string, isActive: boolean) =>
    actions.updateIngredient(id, { isActive }),
  );
  const remove = useServerAction(actions.deleteIngredient, { successMessage: t('deleted') });

  const openMovement = (ingredient: Ingredient, kind: MovementKind) => {
    setInvalid(false);
    setMovement({
      ingredient,
      kind,
      quantity: quantityDraft(null, ingredient.unit),
      note: '',
    });
  };

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <div className="grid gap-1">
            <CardTitle>{t('list')}</CardTitle>
            <CardDescription>{t('listHint')}</CardDescription>
          </div>
          <Button
            onClick={() => {
              setInvalid(false);
              setDraft({
                name: '',
                unit: 'g',
                threshold: quantityDraft(null, 'g'),
                isActive: true,
              });
            }}
          >
            <PlusIcon /> {t('new')}
          </Button>
        </CardHeader>
        {ingredients.length === 0 ? (
          <p className="text-muted-foreground">{t('empty')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tc('name')}</TableHead>
                {hasLocation ? <TableHead className="text-right">{t('onHand')}</TableHead> : null}
                <TableHead className="text-right">{t('threshold')}</TableHead>
                <TableHead>{tc('status')}</TableHead>
                <TableHead>{tc('active')}</TableHead>
                <TableHead className="text-right">{tc('actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ingredients.map((ingredient) => (
                <TableRow
                  key={ingredient.id}
                  data-testid={`ingredient-${ingredient.name}`}
                  className={cn(ingredient.isLow && 'bg-destructive/5')}
                >
                  <TableCell className="font-medium">
                    <Link
                      href={`/backoffice/inventory/${ingredient.id}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {ingredient.name}
                    </Link>
                  </TableCell>
                  {hasLocation ? (
                    <TableCell
                      className={cn(
                        'text-right font-semibold tabular-nums',
                        ingredient.isLow && 'text-destructive',
                      )}
                      data-testid="on-hand"
                    >
                      {format(ingredient.onHand ?? 0, ingredient.unit)}
                    </TableCell>
                  ) : null}
                  <TableCell className="text-right text-muted-foreground tabular-nums">
                    {ingredient.lowStockThreshold === null
                      ? t('noThreshold')
                      : format(ingredient.lowStockThreshold, ingredient.unit)}
                  </TableCell>
                  <TableCell>
                    {!ingredient.isActive ? (
                      <Badge variant="secondary">{t('state.inactive')}</Badge>
                    ) : ingredient.isLow ? (
                      <Badge variant="destructive">
                        <TriangleAlertIcon className="size-3.5" /> {t('state.low')}
                      </Badge>
                    ) : ingredient.lowStockThreshold !== null && hasLocation ? (
                      <Badge variant="success">{t('state.ok')}</Badge>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={ingredient.isActive}
                      disabled={toggle.pending}
                      onCheckedChange={(checked) => void toggle.run(ingredient.id, checked)}
                      aria-label={`${tc('active')}: ${ingredient.name}`}
                    />
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {hasLocation ? (
                      <>
                        <Button
                          variant="outline"
                          size="default"
                          onClick={() => openMovement(ingredient, 'purchase')}
                        >
                          <ShoppingCartIcon /> {t('movement.kinds.purchase')}
                        </Button>{' '}
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`${t('movement.kinds.count')}: ${ingredient.name}`}
                          title={t('movement.kinds.count')}
                          onClick={() => openMovement(ingredient, 'count')}
                        >
                          <ClipboardCheckIcon />
                        </Button>
                        <Button
                          asChild
                          variant="ghost"
                          size="icon"
                          aria-label={`${t('history.movements')}: ${ingredient.name}`}
                          title={t('history.movements')}
                        >
                          <Link href={`/backoffice/inventory/${ingredient.id}`}>
                            <HistoryIcon />
                          </Link>
                        </Button>
                      </>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`${tc('edit')}: ${ingredient.name}`}
                      onClick={() => {
                        setInvalid(false);
                        setDraft({
                          id: ingredient.id,
                          name: ingredient.name,
                          unit: ingredient.unit,
                          threshold: quantityDraft(ingredient.lowStockThreshold, ingredient.unit),
                          isActive: ingredient.isActive,
                        });
                      }}
                    >
                      <PencilIcon />
                    </Button>
                    <ConfirmButton
                      variant="ghost"
                      size="icon"
                      aria-label={`${tc('delete')}: ${ingredient.name}`}
                      disabled={remove.pending}
                      title={t('deleteTitle', { name: ingredient.name })}
                      description={t('deleteText')}
                      confirmLabel={tc('delete')}
                      cancelLabel={tc('cancel')}
                      onConfirm={() => remove.run(ingredient.id)}
                    >
                      <Trash2Icon />
                    </ConfirmButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Dialog open={!!draft} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent closeLabel={tc('close')}>
          {draft ? (
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (draftQuantity(draft.threshold, draft.unit) === undefined) {
                  setInvalid(true);
                  return;
                }
                void save.run(draft);
              }}
            >
              <DialogHeader>
                <DialogTitle>{draft.id ? t('edit') : t('new')}</DialogTitle>
              </DialogHeader>
              <Field label={tc('name')} htmlFor="ingredient-name" error={save.fieldErrors.name}>
                <Input
                  id="ingredient-name"
                  value={draft.name}
                  required
                  maxLength={100}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </Field>
              <Field
                label={t('unit')}
                htmlFor="ingredient-unit"
                hint={draft.id ? undefined : t('unitFixed')}
              >
                <Select
                  value={draft.unit}
                  disabled={!!draft.id}
                  onValueChange={(unit) =>
                    setDraft({
                      ...draft,
                      unit: unit as StockUnit,
                      threshold: quantityDraft(null, unit as StockUnit),
                    })
                  }
                >
                  <SelectTrigger id="ingredient-unit">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STOCK_UNITS.map((unit) => (
                      <SelectItem key={unit} value={unit}>
                        {t(`units.${unit}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field
                label={t('threshold')}
                htmlFor="ingredient-threshold"
                hint={t('thresholdHint')}
                error={invalid ? t('invalidQuantity') : save.fieldErrors.lowStockThreshold}
              >
                <QuantityInput
                  id="ingredient-threshold"
                  unit={draft.unit}
                  value={draft.threshold}
                  onChange={(threshold) => {
                    setInvalid(false);
                    setDraft({ ...draft, threshold });
                  }}
                />
              </Field>
              <div className="flex items-center gap-3">
                <Switch
                  id="ingredient-active"
                  checked={draft.isActive}
                  onCheckedChange={(isActive) => setDraft({ ...draft, isActive })}
                />
                <Label htmlFor="ingredient-active">{tc('active')}</Label>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDraft(null)}>
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

      <Dialog open={!!movement} onOpenChange={(open) => !open && setMovement(null)}>
        <DialogContent closeLabel={tc('close')}>
          {movement ? (
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                const quantity = draftQuantity(movement.quantity, movement.ingredient.unit);
                if (quantity === undefined || quantity === null) {
                  setInvalid(true);
                  return;
                }
                void record.run(movement.ingredient.id, {
                  kind: movement.kind,
                  quantity,
                  note: movement.note.trim() || null,
                });
              }}
            >
              <DialogHeader>
                <DialogTitle>
                  {t('movement.title', {
                    kind: t(`movement.kinds.${movement.kind}`),
                    name: movement.ingredient.name,
                  })}
                </DialogTitle>
                <DialogDescription>
                  {t('movement.now', {
                    quantity: format(movement.ingredient.onHand ?? 0, movement.ingredient.unit),
                  })}
                </DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup">
                {MOVEMENT_KINDS.map((kind) => (
                  <Button
                    key={kind}
                    type="button"
                    role="radio"
                    aria-checked={movement.kind === kind}
                    variant={movement.kind === kind ? 'default' : 'outline'}
                    onClick={() => setMovement({ ...movement, kind })}
                  >
                    {t(`movement.kinds.${kind}`)}
                  </Button>
                ))}
              </div>
              <p className="text-sm text-muted-foreground">
                {t(`movement.hints.${movement.kind}`)}
              </p>
              <Field
                label={t('movement.quantity')}
                htmlFor="movement-quantity"
                error={invalid ? t('invalidQuantity') : save.fieldErrors.quantity}
              >
                <QuantityInput
                  id="movement-quantity"
                  unit={movement.ingredient.unit}
                  value={movement.quantity}
                  allowNegative={movement.kind === 'adjustment'}
                  onChange={(quantity) => {
                    setInvalid(false);
                    setMovement({ ...movement, quantity });
                  }}
                />
              </Field>
              <Field label={t('movement.note')} htmlFor="movement-note">
                <Input
                  id="movement-note"
                  value={movement.note}
                  maxLength={200}
                  placeholder={t('movement.notePlaceholder')}
                  onChange={(event) => setMovement({ ...movement, note: event.target.value })}
                />
              </Field>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setMovement(null)}>
                  {tc('cancel')}
                </Button>
                <Button type="submit" disabled={record.pending}>
                  {t('movement.save')}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
