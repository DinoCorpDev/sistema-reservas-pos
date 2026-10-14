'use client';

import { ALLERGENS, type Allergen, normalizeAllergies, type OrderState } from '@pos/core';
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
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { updateOrder } from '../../actions';
import { useRunner } from './run';

/**
 * Allergies at the table (DEC-037): what a guest is allergic to, one of the 14 allergens or any
 * free text. The kitchen sees it on every ticket of the order, whatever was ordered.
 */
export function AllergyDialog({
  order,
  open,
  onClose,
}: {
  order: OrderState;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('posOrder.allergy');
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg" closeLabel={t('cancel')}>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        {/* Mounted per opening, so it starts from what the order has now. */}
        {open && <AllergyForm order={order} onDone={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function AllergyForm({ order, onDone }: { order: OrderState; onDone: () => void }) {
  const t = useTranslations('posOrder.allergy');
  const ta = useTranslations('posOrder.allergens');
  const run = useRunner();
  const [selected, setSelected] = useState<Set<Allergen>>(
    () => new Set(order.allergies?.allergens ?? []),
  );
  const [note, setNote] = useState(order.allergies?.note ?? '');
  const [busy, setBusy] = useState(false);

  const toggle = (allergen: Allergen) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(allergen)) next.delete(allergen);
      else next.add(allergen);
      return next;
    });

  async function save(allergies: OrderState['allergies']) {
    setBusy(true);
    const result = await run(() => updateOrder(order.id, { allergies }));
    setBusy(false);
    if (result.ok) onDone();
  }

  const wanted = normalizeAllergies({ allergens: [...selected], note });
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save(wanted);
      }}
    >
      <div
        className="grid grid-cols-2 gap-2 sm:grid-cols-3"
        role="group"
        aria-label={t('allergens')}
      >
        {ALLERGENS.map((allergen) => {
          const on = selected.has(allergen);
          return (
            <Button
              key={allergen}
              type="button"
              variant="outline"
              aria-pressed={on}
              onClick={() => toggle(allergen)}
              className={cn(
                'min-h-11 justify-start whitespace-normal text-left',
                on && 'border-destructive bg-destructive/10 font-semibold text-destructive',
              )}
            >
              {ta(allergen)}
            </Button>
          );
        })}
      </div>
      <Field label={t('other')} htmlFor="allergy-other">
        <Input
          id="allergy-other"
          value={note}
          maxLength={200}
          onChange={(event) => setNote(event.target.value)}
          placeholder={t('otherPlaceholder')}
          className="h-11 text-base"
        />
      </Field>
      <DialogFooter className="gap-2">
        {order.allergies && (
          <Button
            type="button"
            variant="outline"
            size="lg"
            disabled={busy}
            onClick={() => void save(null)}
          >
            {t('remove')}
          </Button>
        )}
        <Button type="submit" size="lg" disabled={busy || (!wanted && !order.allergies)}>
          {t('save')}
        </Button>
      </DialogFooter>
    </form>
  );
}
