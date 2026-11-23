'use client';

import type { catalog } from '@pos/api';
import { CONTENT_LANGUAGES } from '@pos/core';
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
import { Input, Textarea } from '@pos/ui/input';
import { Field, Label } from '@pos/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@pos/ui/select';
import { Switch } from '@pos/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@pos/ui/table';
import { EmptyState } from '@pos/ui/empty-state';
import {
  CornerDownRightIcon,
  FolderTreeIcon,
  LanguagesIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  incompleteLanguages,
  type TextDraft,
  textDraftOf,
  textTranslationsInput,
} from '@/components/backoffice/catalog/catalog-data';
import { TextTranslationFields } from '@/components/backoffice/catalog/translation-fields';
import { useServerAction } from '@/components/backoffice/use-server-action';
import * as actions from './actions';

const NO_PARENT = 'none';

type CategoryDraft = {
  id?: string;
  name: string;
  description: string;
  parentId: string | null;
  imageUrl: string;
  sortOrder: number;
  isActive: boolean;
};

/** Categories in tree order (parents before their subcategories), with their depth. */
function treeOf(categories: catalog.CategoryDto[]) {
  const ids = new Set(categories.map((c) => c.id));
  const children = new Map<string | null, catalog.CategoryDto[]>();
  for (const category of categories) {
    const parent = category.parentId && ids.has(category.parentId) ? category.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), category]);
  }
  const rows: { category: catalog.CategoryDto; depth: number }[] = [];
  const seen = new Set<string>();
  const visit = (parent: string | null, depth: number) => {
    for (const category of children.get(parent) ?? []) {
      if (seen.has(category.id)) continue;
      seen.add(category.id);
      rows.push({ category, depth });
      visit(category.id, depth + 1);
    }
  };
  visit(null, 0);
  // A cycle cannot be stored (the use case refuses it); list anything unreachable at the root.
  for (const category of categories) {
    if (!seen.has(category.id)) rows.push({ category, depth: 0 });
  }
  return rows;
}

/** The category and everything below it: none of them can become its parent. */
function selfAndDescendants(categories: catalog.CategoryDto[], id: string) {
  const result = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const category of categories) {
      if (category.parentId && result.has(category.parentId) && !result.has(category.id)) {
        result.add(category.id);
        grew = true;
      }
    }
  }
  return result;
}

export function CategoriesManager({
  categories,
  productCounts,
  locationLanguages,
  defaultLanguage,
  canEdit,
}: {
  categories: catalog.CategoryDto[];
  productCounts: Record<string, number>;
  locationLanguages: string[];
  defaultLanguage?: string;
  canEdit: boolean;
}) {
  const t = useTranslations('categories');
  const tc = useTranslations('common');
  const [draft, setDraft] = useState<CategoryDraft | null>(null);
  const [translating, setTranslating] = useState<{
    category: catalog.CategoryDto;
    texts: TextDraft;
  } | null>(null);

  const save = useServerAction(
    (value: CategoryDraft) => {
      const body = {
        name: value.name.trim(),
        description: value.description.trim() || null,
        parentId: value.parentId,
        imageUrl: value.imageUrl.trim() || null,
        sortOrder: value.sortOrder,
        isActive: value.isActive,
      };
      return value.id ? actions.updateCategory(value.id, body) : actions.createCategory(body);
    },
    { onSuccess: () => setDraft(null) },
  );
  const toggle = useServerAction((id: string, isActive: boolean) =>
    actions.updateCategory(id, { isActive }),
  );
  const remove = useServerAction(actions.deleteCategory, { successMessage: t('deleted') });
  const saveTexts = useServerAction(
    (id: string, texts: TextDraft) =>
      actions.replaceCategoryTranslations(id, textTranslationsInput(texts)),
    { onSuccess: () => setTranslating(null) },
  );

  const rows = treeOf(categories);
  const nameOf = new Map(categories.map((c) => [c.id, c.name]));
  const excluded = draft?.id ? selfAndDescendants(categories, draft.id) : new Set<string>();
  const parentOptions = rows.filter(({ category }) => !excluded.has(category.id));
  const incomplete = translating ? incompleteLanguages(translating.texts) : [];

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <div className="grid gap-1">
            <CardTitle>{t('list')}</CardTitle>
            <CardDescription>{t('listHint')}</CardDescription>
          </div>
          {canEdit ? (
            <Button
              onClick={() =>
                setDraft({
                  name: '',
                  description: '',
                  parentId: null,
                  imageUrl: '',
                  sortOrder: categories.length,
                  isActive: true,
                })
              }
            >
              <PlusIcon /> {t('new')}
            </Button>
          ) : null}
        </CardHeader>
        {categories.length === 0 ? (
          <EmptyState compact icon={<FolderTreeIcon />} title={t('empty')} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tc('name')}</TableHead>
                <TableHead>{t('parent')}</TableHead>
                <TableHead className="text-right">{t('products')}</TableHead>
                <TableHead className="text-right">{tc('sortOrder')}</TableHead>
                <TableHead>{t('translations')}</TableHead>
                <TableHead>{tc('active')}</TableHead>
                {canEdit ? <TableHead className="text-right">{tc('actions')}</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ category, depth }) => {
                const languages = CONTENT_LANGUAGES.filter(
                  (language) => category.translations[language]?.name,
                );
                const count = productCounts[category.id] ?? 0;
                return (
                  <TableRow key={category.id}>
                    <TableCell>
                      <div
                        className="flex items-center gap-2 font-medium"
                        style={{ paddingLeft: `${Math.min(depth, 4) * 1.25}rem` }}
                      >
                        {depth > 0 ? (
                          <CornerDownRightIcon
                            className="size-4 shrink-0 text-muted-foreground"
                            aria-hidden
                          />
                        ) : null}
                        {category.name}
                      </div>
                      {category.description ? (
                        <p
                          className="line-clamp-1 text-xs text-muted-foreground"
                          style={{ paddingLeft: `${Math.min(depth, 4) * 1.25}rem` }}
                        >
                          {category.description}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {category.parentId ? (nameOf.get(category.parentId) ?? '—') : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {count > 0 ? (
                        <Link
                          href={`/backoffice/catalog?category=${category.id}&inactive=1`}
                          className="underline-offset-4 hover:underline"
                        >
                          {count}
                        </Link>
                      ) : (
                        0
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{category.sortOrder}</TableCell>
                    <TableCell>
                      {languages.length > 0 ? (
                        <Badge variant="secondary" className="uppercase">
                          {languages.join(' ')}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={category.isActive}
                        disabled={!canEdit || toggle.pending}
                        onCheckedChange={(checked) => void toggle.run(category.id, checked)}
                        aria-label={`${tc('active')}: ${category.name}`}
                      />
                    </TableCell>
                    {canEdit ? (
                      <TableCell className="text-right whitespace-nowrap">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`${t('translations')}: ${category.name}`}
                          onClick={() =>
                            setTranslating({ category, texts: textDraftOf(category.translations) })
                          }
                        >
                          <LanguagesIcon />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`${tc('edit')}: ${category.name}`}
                          onClick={() =>
                            setDraft({
                              id: category.id,
                              name: category.name,
                              description: category.description ?? '',
                              parentId: category.parentId,
                              imageUrl: category.imageUrl ?? '',
                              sortOrder: category.sortOrder,
                              isActive: category.isActive,
                            })
                          }
                        >
                          <PencilIcon />
                        </Button>
                        <ConfirmButton
                          variant="ghost"
                          size="icon"
                          aria-label={`${tc('delete')}: ${category.name}`}
                          disabled={remove.pending}
                          title={t('deleteTitle', { name: category.name })}
                          description={
                            count > 0 ? t('deleteHasProducts', { count }) : t('deleteText')
                          }
                          confirmLabel={tc('delete')}
                          cancelLabel={tc('cancel')}
                          onConfirm={() => remove.run(category.id)}
                        >
                          <Trash2Icon />
                        </ConfirmButton>
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
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
                void save.run(draft);
              }}
            >
              <DialogHeader>
                <DialogTitle>{draft.id ? t('edit') : t('new')}</DialogTitle>
              </DialogHeader>
              <Field label={tc('name')} htmlFor="category-name" error={save.fieldErrors.name}>
                <Input
                  id="category-name"
                  required
                  autoFocus
                  maxLength={150}
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </Field>
              <Field
                label={t('descriptionLabel')}
                htmlFor="category-description"
                error={save.fieldErrors.description}
              >
                <Textarea
                  id="category-description"
                  maxLength={2000}
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
                <Field label={t('parent')} hint={t('parentHint')} error={save.fieldErrors.parentId}>
                  <Select
                    value={draft.parentId ?? NO_PARENT}
                    onValueChange={(value) =>
                      setDraft({ ...draft, parentId: value === NO_PARENT ? null : value })
                    }
                  >
                    <SelectTrigger aria-label={t('parent')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_PARENT}>{t('noParent')}</SelectItem>
                      {parentOptions.map(({ category, depth }) => (
                        <SelectItem key={category.id} value={category.id}>
                          {`${'– '.repeat(depth)}${category.name}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field
                  label={tc('sortOrder')}
                  htmlFor="category-sort"
                  error={save.fieldErrors.sortOrder}
                >
                  <Input
                    id="category-sort"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={draft.sortOrder}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        sortOrder: Math.max(0, Math.trunc(Number(e.target.value) || 0)),
                      })
                    }
                  />
                </Field>
              </div>
              <Field
                label={t('imageUrl')}
                htmlFor="category-image"
                hint={t('imageUrlHint')}
                error={save.fieldErrors.imageUrl}
              >
                <Input
                  id="category-image"
                  type="url"
                  inputMode="url"
                  maxLength={500}
                  placeholder="https://"
                  value={draft.imageUrl}
                  onChange={(e) => setDraft({ ...draft, imageUrl: e.target.value })}
                />
              </Field>
              <div className="flex items-start gap-3">
                <Switch
                  id="category-active"
                  className="mt-0.5"
                  checked={draft.isActive}
                  onCheckedChange={(isActive) => setDraft({ ...draft, isActive })}
                />
                <div className="grid gap-1">
                  <Label htmlFor="category-active">{tc('active')}</Label>
                  <p className="text-sm text-muted-foreground">{t('activeHint')}</p>
                </div>
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

      <Dialog open={!!translating} onOpenChange={(open) => !open && setTranslating(null)}>
        <DialogContent closeLabel={tc('close')} className="sm:max-w-3xl">
          {translating ? (
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (incomplete.length > 0) return;
                void saveTexts.run(translating.category.id, translating.texts);
              }}
            >
              <DialogHeader>
                <DialogTitle>
                  {t('translationsOf', { name: translating.category.name })}
                </DialogTitle>
                <DialogDescription>{t('translationsHint')}</DialogDescription>
              </DialogHeader>
              <TextTranslationFields
                idPrefix="category-translation"
                value={translating.texts}
                locationLanguages={locationLanguages}
                defaultLanguage={defaultLanguage}
                onChange={(texts) => setTranslating({ ...translating, texts })}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setTranslating(null)}>
                  {tc('cancel')}
                </Button>
                <Button type="submit" disabled={saveTexts.pending || incomplete.length > 0}>
                  {saveTexts.pending ? tc('saving') : tc('save')}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
