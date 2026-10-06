'use client';

import type { admin, catalog } from '@pos/api';
import { Alert } from '@pos/ui/alert';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@pos/ui/select';
import { PlusIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { COURSES, commitAmountOnEnter } from '@/components/backoffice/catalog/catalog-data';
import { ChfInput } from '@/components/backoffice/chf-input';
import { useServerAction } from '@/components/backoffice/use-server-action';
import { createProduct } from './actions';

type Draft = {
  name: string;
  categoryId: string;
  taxCategoryId: string;
  priceRappen: number | null;
  defaultCourse: number;
};

/** "Neues Produkt": the minimum to create it; everything else is completed in the editor. */
export function NewProductDialog({
  categories,
  taxCategories,
}: {
  categories: catalog.CategoryDto[];
  taxCategories: admin.TaxCategoryDto[];
}) {
  const t = useTranslations('products');
  const tc = useTranslations('common');
  const tco = useTranslations('courses');
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [priceMissing, setPriceMissing] = useState(false);
  const save = useServerAction(createProduct, {
    successMessage: t('created'),
    onSuccess: (product) => {
      setDraft(null);
      router.push(`/backoffice/catalog/products/${product.id}`);
    },
  });

  const open = () => {
    const food = taxCategories.find((c) => c.key === 'food') ?? taxCategories[0];
    setPriceMissing(false);
    setDraft({
      name: '',
      categoryId: categories.find((c) => c.isActive)?.id ?? categories[0]?.id ?? '',
      taxCategoryId: food?.id ?? '',
      priceRappen: null,
      defaultCourse: 2,
    });
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    if (draft.priceRappen === null) {
      setPriceMissing(true);
      return;
    }
    void save.run({
      name: draft.name,
      categoryId: draft.categoryId,
      taxCategoryId: draft.taxCategoryId,
      basePriceRappen: draft.priceRappen,
      defaultCourse: draft.defaultCourse,
    });
  };

  const ready = categories.length > 0 && taxCategories.length > 0;

  return (
    <>
      <Button onClick={open}>
        <PlusIcon /> {t('new')}
      </Button>
      <Dialog open={!!draft} onOpenChange={(isOpen) => !isOpen && setDraft(null)}>
        <DialogContent closeLabel={tc('close')}>
          {draft ? (
            <form className="grid gap-4" onSubmit={submit}>
              <DialogHeader>
                <DialogTitle>{t('new')}</DialogTitle>
                <DialogDescription>{t('newHint')}</DialogDescription>
              </DialogHeader>
              {!ready ? (
                <Alert variant="warning">
                  {categories.length === 0 ? (
                    <>
                      {t('needCategory')}{' '}
                      <Link href="/backoffice/catalog/categories" className="underline">
                        {t('toCategories')}
                      </Link>
                    </>
                  ) : (
                    t('needTaxCategory')
                  )}
                </Alert>
              ) : null}
              <Field label={tc('name')} htmlFor="new-product-name" error={save.fieldErrors.name}>
                <Input
                  id="new-product-name"
                  required
                  autoFocus
                  maxLength={150}
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('category')} error={save.fieldErrors.categoryId}>
                  <Select
                    value={draft.categoryId}
                    onValueChange={(categoryId) => setDraft({ ...draft, categoryId })}
                  >
                    <SelectTrigger aria-label={t('category')}>
                      <SelectValue placeholder={t('chooseCategory')} />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((category) => (
                        <SelectItem key={category.id} value={category.id}>
                          {category.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label={t('taxCategory')} error={save.fieldErrors.taxCategoryId}>
                  <Select
                    value={draft.taxCategoryId}
                    onValueChange={(taxCategoryId) => setDraft({ ...draft, taxCategoryId })}
                  >
                    <SelectTrigger aria-label={t('taxCategory')}>
                      <SelectValue placeholder={t('chooseTaxCategory')} />
                    </SelectTrigger>
                    <SelectContent>
                      {taxCategories.map((category) => (
                        <SelectItem key={category.id} value={category.id}>
                          {category.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field
                  label={t('price')}
                  htmlFor="new-product-price"
                  hint={t('priceHint')}
                  error={priceMissing ? t('priceRequired') : save.fieldErrors.basePriceRappen}
                >
                  <ChfInput
                    id="new-product-price"
                    value={draft.priceRappen}
                    aria-invalid={priceMissing}
                    onKeyDown={commitAmountOnEnter}
                    onValueChange={(priceRappen) => {
                      setPriceMissing(false);
                      setDraft({ ...draft, priceRappen });
                    }}
                  />
                </Field>
                <Field label={t('defaultCourse')}>
                  <Select
                    value={String(draft.defaultCourse)}
                    onValueChange={(value) => setDraft({ ...draft, defaultCourse: Number(value) })}
                  >
                    <SelectTrigger aria-label={t('defaultCourse')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {COURSES.map((course) => (
                        <SelectItem key={course} value={String(course)}>
                          {tco(String(course))}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDraft(null)}>
                  {tc('cancel')}
                </Button>
                <Button
                  type="submit"
                  disabled={save.pending || !ready || !draft.categoryId || !draft.taxCategoryId}
                >
                  {save.pending ? tc('saving') : tc('create')}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
