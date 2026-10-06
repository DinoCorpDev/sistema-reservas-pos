'use client';

import type { admin, catalog } from '@pos/api';
import { Alert, AlertDescription, AlertTitle } from '@pos/ui/alert';
import { Button } from '@pos/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@pos/ui/card';
import { Input, Textarea } from '@pos/ui/input';
import { Field, Label } from '@pos/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@pos/ui/select';
import { Switch } from '@pos/ui/switch';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { COURSES, commitAmountOnEnter } from '@/components/backoffice/catalog/catalog-data';
import { useDraft } from '@/components/backoffice/catalog/use-draft';
import { ChfInput } from '@/components/backoffice/chf-input';
import { useServerAction } from '@/components/backoffice/use-server-action';
import { updateProduct } from '../../actions';
import type { TabProps } from './editor-shared';

const basicsOf = (p: catalog.ProductDto) => ({
  name: p.name,
  description: p.description ?? '',
  categoryId: p.categoryId,
  taxCategoryId: p.taxCategoryId,
  basePriceRappen: p.basePriceRappen as number | null,
  sku: p.sku ?? '',
  defaultCourse: p.defaultCourse,
  imageUrl: p.imageUrl ?? '',
  sortOrder: p.sortOrder,
  isActive: p.isActive,
  requiresOrigin: p.requiresOrigin,
  publishQr: p.publishQr,
  publishWeb: p.publishWeb,
});
type Basics = ReturnType<typeof basicsOf>;

const OPTIONAL_TEXT = new Set<keyof Basics>(['description', 'sku', 'imageUrl']);

/** Only the fields the person changed are sent, so a stale form never overwrites newer data. */
function patchOf(draft: Basics, base: Basics) {
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(draft) as (keyof Basics)[]) {
    if (draft[key] === base[key]) continue;
    const value = draft[key];
    patch[key] =
      typeof value === 'string'
        ? OPTIONAL_TEXT.has(key)
          ? value.trim() || null
          : value.trim()
        : value;
  }
  return patch;
}

const isHttpUrl = (value: string) => /^https?:\/\/\S+$/i.test(value.trim());

/** Name, texts, category, MWST category, price, course, image, status and publication (RN-18). */
export function BasicsTab({
  product,
  permissions,
  categories,
  taxCategories,
  onOpenTab,
}: TabProps & {
  categories: catalog.CategoryDto[];
  taxCategories: admin.TaxCategoryDto[];
  onOpenTab: (tab: string) => void;
}) {
  const t = useTranslations('productEditor');
  const tb = useTranslations('basics');
  const tp = useTranslations('publication');
  const tc = useTranslations('common');
  const tco = useTranslations('courses');
  const { draft, base, dirty, setDraft, reset } = useDraft(basicsOf(product));
  const save = useServerAction((patch: Record<string, unknown>) => updateProduct(product.id, patch), {
    onSuccess: (saved) => reset(basicsOf(saved)),
  });
  const set = <K extends keyof Basics>(key: K, value: Basics[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const canEdit = permissions.manage;
  const hasVariants = product.variants.length > 0;
  const canEditPrice = canEdit && permissions.priceChange && !hasVariants;
  const issues = product.publication.issues;
  const publishError = save.fieldErrors.publishQr ?? save.fieldErrors.publishWeb;
  const courses: number[] = (COURSES as readonly number[]).includes(draft.defaultCourse)
    ? [...COURSES]
    : [...COURSES, draft.defaultCourse];

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (draft.basePriceRappen === null) return;
    const patch = patchOf(draft, base);
    if (Object.keys(patch).length > 0) void save.run(patch);
  };

  const toggle = (key: 'isActive' | 'requiresOrigin' | 'publishQr' | 'publishWeb', label: ReactNode, hint?: ReactNode) => (
    <div className="flex items-start gap-3">
      <Switch
        id={`basics-${key}`}
        checked={draft[key]}
        disabled={!canEdit}
        onCheckedChange={(checked) => set(key, checked)}
        className="mt-0.5"
      />
      <div className="grid gap-1">
        <Label htmlFor={`basics-${key}`}>{label}</Label>
        {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
      </div>
    </div>
  );

  return (
    <form onSubmit={submit} className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{tb('title')}</CardTitle>
          <CardDescription>{tb('hint')}</CardDescription>
        </CardHeader>
        <CardContent className="md:grid-cols-2">
          <Field
            label={tc('name')}
            htmlFor="basics-name"
            error={save.fieldErrors.name}
            className="md:col-span-2"
          >
            <Input
              id="basics-name"
              required
              maxLength={150}
              value={draft.name}
              disabled={!canEdit}
              aria-invalid={!!save.fieldErrors.name}
              onChange={(e) => set('name', e.target.value)}
            />
          </Field>
          <Field
            label={tb('description')}
            htmlFor="basics-description"
            hint={tb('descriptionHint')}
            error={save.fieldErrors.description}
            className="md:col-span-2"
          >
            <Textarea
              id="basics-description"
              maxLength={2000}
              value={draft.description}
              disabled={!canEdit}
              onChange={(e) => set('description', e.target.value)}
            />
          </Field>
          <Field label={tb('category')} error={save.fieldErrors.categoryId}>
            <Select
              value={draft.categoryId}
              disabled={!canEdit}
              onValueChange={(value) => set('categoryId', value)}
            >
              <SelectTrigger aria-label={tb('category')}>
                <SelectValue />
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
          <Field
            label={tb('taxCategory')}
            hint={tb('taxCategoryHint')}
            error={save.fieldErrors.taxCategoryId}
          >
            <Select
              value={draft.taxCategoryId}
              disabled={!canEdit}
              onValueChange={(value) => set('taxCategoryId', value)}
            >
              <SelectTrigger aria-label={tb('taxCategory')}>
                <SelectValue />
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
            label={tb('basePrice')}
            htmlFor="basics-price"
            hint={
              hasVariants
                ? tb('basePriceVariants')
                : !permissions.priceChange
                  ? t('noPricePermission')
                  : tb('basePriceHint')
            }
            error={
              draft.basePriceRappen === null ? tb('priceRequired') : save.fieldErrors.basePriceRappen
            }
          >
            <ChfInput
              id="basics-price"
              value={draft.basePriceRappen}
              disabled={!canEditPrice}
              onKeyDown={commitAmountOnEnter}
              onValueChange={(value) => set('basePriceRappen', value)}
            />
          </Field>
          <Field label={tb('sku')} htmlFor="basics-sku" hint={tb('skuHint')} error={save.fieldErrors.sku}>
            <Input
              id="basics-sku"
              maxLength={64}
              className="font-mono"
              value={draft.sku}
              disabled={!canEdit}
              onChange={(e) => set('sku', e.target.value)}
            />
          </Field>
          <Field label={tb('defaultCourse')} hint={tb('defaultCourseHint')}>
            <Select
              value={String(draft.defaultCourse)}
              disabled={!canEdit}
              onValueChange={(value) => set('defaultCourse', Number(value))}
            >
              <SelectTrigger aria-label={tb('defaultCourse')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {courses.map((course) => (
                  <SelectItem key={course} value={String(course)}>
                    {course <= 3 ? tco(String(course)) : tco('other', { course })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field
            label={tc('sortOrder')}
            htmlFor="basics-sort"
            hint={tb('sortOrderHint')}
            error={save.fieldErrors.sortOrder}
          >
            <Input
              id="basics-sort"
              type="number"
              inputMode="numeric"
              min={0}
              value={draft.sortOrder}
              disabled={!canEdit}
              onChange={(e) => set('sortOrder', Math.max(0, Math.trunc(Number(e.target.value) || 0)))}
            />
          </Field>
          <div className="grid gap-3 md:col-span-2 md:grid-cols-[1fr_auto] md:items-end">
            <Field
              label={tb('imageUrl')}
              htmlFor="basics-image"
              hint={tb('imageUrlHint')}
              error={save.fieldErrors.imageUrl}
            >
              <Input
                id="basics-image"
                type="url"
                inputMode="url"
                maxLength={500}
                placeholder="https://"
                value={draft.imageUrl}
                disabled={!canEdit}
                onChange={(e) => set('imageUrl', e.target.value)}
              />
            </Field>
            {isHttpUrl(draft.imageUrl) ? (
              <div
                role="img"
                aria-label={tb('imagePreview')}
                className="size-24 rounded-lg border bg-muted bg-cover bg-center"
                style={{ backgroundImage: `url(${JSON.stringify(draft.imageUrl.trim())})` }}
              />
            ) : null}
          </div>
          <div className="md:col-span-2">
            {toggle('isActive', tb('isActive'), tb('isActiveHint'))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{tp('title')}</CardTitle>
          <CardDescription>{tp('hint')}</CardDescription>
        </CardHeader>
        <CardContent>
          {toggle('requiresOrigin', tb('requiresOrigin'), tb('requiresOriginHint'))}
          {toggle('publishQr', tp('publishQr'))}
          {toggle('publishWeb', tp('publishWeb'))}
          {publishError ? (
            <Alert variant="destructive">
              <AlertTitle>{tp('blockedTitle')}</AlertTitle>
              <AlertDescription className="text-destructive">{publishError}</AlertDescription>
            </Alert>
          ) : null}
          {issues.length > 0 ? (
            <Alert variant="warning">
              <AlertTitle>{tp('missingTitle')}</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-5">
                  {issues.map((issue) => (
                    <li key={issue}>{tp(`issueHints.${issue}`)}</li>
                  ))}
                </ul>
                <Button
                  type="button"
                  variant="link"
                  className="h-auto min-h-11 px-0"
                  onClick={() => onOpenTab('allergens')}
                >
                  {tp('complete')}
                </Button>
              </AlertDescription>
            </Alert>
          ) : (
            <Alert variant="success">{tp('ready')}</Alert>
          )}
        </CardContent>
        {canEdit ? (
          <CardFooter>
            {dirty ? (
              <Button type="button" variant="outline" onClick={() => reset()}>
                {t('discard')}
              </Button>
            ) : null}
            <Button type="submit" disabled={save.pending || !dirty || draft.basePriceRappen === null}>
              {save.pending ? tc('saving') : tc('save')}
            </Button>
          </CardFooter>
        ) : null}
      </Card>
    </form>
  );
}
