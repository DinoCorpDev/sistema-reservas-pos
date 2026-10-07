'use client';

import {
  type Channel,
  formatChf,
  MAX_COURSE,
  type MenuModifierGroup,
  type MenuProduct,
  rappen,
  validateModifierSelection,
} from '@pos/core';
import { Button } from '@pos/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@pos/ui/dialog';
import { Input } from '@pos/ui/input';
import { Field } from '@pos/ui/label';
import { cn } from '@pos/ui/utils';
import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useId, useMemo, useState } from 'react';
import { courseOf } from './format';
import { useAddLine } from './add-line';
import { NumberStepper } from './stepper';

/** A product with choices (RF-C08): variant, options per group (min/max), quantity, note, seat, course. */
export function ProductDialog({
  product,
  orderId,
  channel,
  onClose,
}: {
  product: MenuProduct | null;
  orderId: string;
  channel: Channel;
  onClose: () => void;
}) {
  const tc = useTranslations('posOrder.common');
  return (
    <Dialog open={product !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl" closeLabel={tc('close')}>
        {product && (
          <ProductForm
            key={product.id}
            product={product}
            orderId={orderId}
            channel={channel}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ProductForm({
  product,
  orderId,
  channel,
  onClose,
}: {
  product: MenuProduct;
  orderId: string;
  channel: Channel;
  onClose: () => void;
}) {
  const t = useTranslations('posOrder.product');
  const tc = useTranslations('posOrder.common');
  const addLine = useAddLine(orderId, channel);
  const defaultVariant = product.variants.find((v) => v.isDefault) ?? product.variants[0] ?? null;
  const [variantId, setVariantId] = useState(defaultVariant?.id ?? null);
  const [chosen, setChosen] = useState<ReadonlyMap<string, readonly string[]>>(new Map());
  const [quantity, setQuantity] = useState<number | null>(1);
  const [note, setNote] = useState('');
  const [seat, setSeat] = useState<number | null>(null);
  const [course, setCourse] = useState<number | null>(courseOf(product));
  const [busy, setBusy] = useState(false);
  const noteId = useId();

  const modifiers = useMemo(
    () => [...chosen.values()].flat().map((modifierId) => ({ modifierId, quantity: 1 })),
    [chosen],
  );
  const issues = useMemo(
    () =>
      validateModifierSelection(
        product.modifierGroups.map((group) => ({
          id: group.id,
          minSelect: group.minSelect,
          maxSelect: group.maxSelect,
          modifierIds: group.modifiers.map((m) => m.id),
        })),
        modifiers,
      ),
    [product, modifiers],
  );
  const missing = new Set(
    issues.flatMap((issue) => (issue.code === 'below_min' ? [issue.groupId] : [])),
  );

  const unitPrice =
    (product.variants.find((v) => v.id === variantId)?.priceRappen ?? product.priceRappen) +
    product.modifierGroups
      .flatMap((group) => group.modifiers)
      .filter((m) => modifiers.some((choice) => choice.modifierId === m.id))
      .reduce((sum, m) => sum + m.priceDeltaRappen, 0);
  const valid = issues.length === 0 && quantity !== null && course !== null;

  function toggle(group: MenuModifierGroup, modifierId: string) {
    setChosen((previous) => {
      const current = previous.get(group.id) ?? [];
      const next = current.includes(modifierId)
        ? current.filter((id) => id !== modifierId)
        : group.maxSelect === 1
          ? [modifierId]
          : current.length < group.maxSelect
            ? [...current, modifierId]
            : current;
      return new Map(previous).set(group.id, next);
    });
  }

  async function add() {
    if (issues.length > 0 || quantity === null || course === null || busy) return;
    setBusy(true);
    const result = await addLine({
      product,
      variantId,
      modifiers,
      quantity,
      note: note.trim() === '' ? null : note.trim(),
      seat,
      course,
    });
    setBusy(false);
    if (result.ok) onClose();
  }

  return (
    <form
      className="grid gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void add();
      }}
    >
      <DialogHeader>
        <DialogTitle>{product.name}</DialogTitle>
        <DialogDescription>
          {product.description
            ? `${formatChf(product.priceRappen)} · ${product.description}`
            : formatChf(product.priceRappen)}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="grid content-start gap-5">
          {product.variants.length > 1 && (
            <ChoiceGroup label={t('variant')} hint={null} missing={false} single>
              {product.variants.map((variant) => (
                <Choice
                  key={variant.id}
                  role="radio"
                  selected={variant.id === variantId}
                  onClick={() => setVariantId(variant.id)}
                  label={variant.name}
                  price={formatChf(variant.priceRappen)}
                />
              ))}
            </ChoiceGroup>
          )}
          {product.modifierGroups.map((group) => {
            const selected = chosen.get(group.id) ?? [];
            const full = group.maxSelect > 1 && selected.length >= group.maxSelect;
            return (
              <ChoiceGroup
                key={group.id}
                label={group.name}
                hint={ruleOf(group, t)}
                missing={missing.has(group.id)}
                single={group.maxSelect === 1}
              >
                {group.modifiers.map((modifier) => {
                  const on = selected.includes(modifier.id);
                  return (
                    <Choice
                      key={modifier.id}
                      role={group.maxSelect === 1 ? 'radio' : 'checkbox'}
                      selected={on}
                      disabled={!on && full}
                      onClick={() => toggle(group, modifier.id)}
                      label={modifier.name}
                      price={
                        modifier.priceDeltaRappen === 0
                          ? null
                          : `+ ${formatChf(modifier.priceDeltaRappen)}`
                      }
                    />
                  );
                })}
              </ChoiceGroup>
            );
          })}
        </div>

        <div className="grid content-start gap-4">
          <NumberStepper
            label={t('quantity')}
            value={quantity}
            onChange={setQuantity}
            min={1}
            max={999}
          />
          <Field label={t('note')} htmlFor={noteId}>
            <Input
              id={noteId}
              value={note}
              maxLength={500}
              placeholder={t('notePlaceholder')}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
          <NumberStepper
            label={t('seat')}
            value={seat}
            onChange={setSeat}
            min={1}
            max={99}
            allowEmpty
          />
          <NumberStepper
            label={t('course')}
            value={course}
            onChange={setCourse}
            min={1}
            max={MAX_COURSE}
          />
        </div>
      </div>

      <DialogFooter className="items-center">
        <p className="mr-auto text-lg font-semibold tabular-nums" aria-live="polite">
          {t('total', { amount: formatChf(rappen(unitPrice * (quantity ?? 0))) })}
        </p>
        <Button type="button" variant="outline" size="lg" onClick={onClose}>
          {tc('cancel')}
        </Button>
        <Button type="submit" size="lg" disabled={!valid || busy}>
          {t('add')}
        </Button>
      </DialogFooter>
    </form>
  );
}

function ruleOf(
  group: MenuModifierGroup,
  t: (key: string, values?: Record<string, number>) => string,
) {
  const { minSelect: min, maxSelect: max } = group;
  if (min > 0 && min === max) return t('chooseExactly', { count: min });
  if (min > 0) return t('chooseRange', { min, max });
  return max === 1 ? t('chooseOptional') : t('chooseUpTo', { max });
}

function ChoiceGroup({
  label,
  hint,
  missing,
  single,
  children,
}: {
  label: string;
  hint: string | null;
  missing: boolean;
  /** Only one choice: a radio group. */
  single: boolean;
  children: ReactNode;
}) {
  const labelId = useId();
  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span id={labelId} className="font-medium">
          {label}
        </span>
        {hint && (
          <span
            className={cn(
              'text-sm',
              missing ? 'font-medium text-destructive' : 'text-muted-foreground',
            )}
          >
            {hint}
          </span>
        )}
      </div>
      <div
        role={single ? 'radiogroup' : 'group'}
        aria-labelledby={labelId}
        className="grid grid-cols-2 gap-2"
      >
        {children}
      </div>
    </div>
  );
}

function Choice({
  role,
  selected,
  disabled,
  onClick,
  label,
  price,
}: {
  role: 'radio' | 'checkbox';
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
  label: string;
  price: string | null;
}) {
  return (
    <Button
      type="button"
      role={role}
      aria-checked={selected}
      variant={selected ? 'default' : 'outline'}
      disabled={disabled}
      onClick={onClick}
      className="h-auto min-h-14 justify-start gap-2 py-2 text-left whitespace-normal"
    >
      <Check className={cn(!selected && 'invisible')} aria-hidden />
      <span className="flex flex-col">
        <span>{label}</span>
        {price && <span className="text-sm opacity-80">{price}</span>}
      </span>
    </Button>
  );
}
