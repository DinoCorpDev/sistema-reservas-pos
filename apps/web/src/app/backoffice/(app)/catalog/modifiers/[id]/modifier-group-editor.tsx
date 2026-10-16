'use client';

import type { catalog } from '@pos/api';
import { Alert } from '@pos/ui/alert';
import { Badge } from '@pos/ui/badge';
import { Button } from '@pos/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@pos/ui/card';
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
import { Switch } from '@pos/ui/switch';
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowUpIcon,
  LanguagesIcon,
  PlusIcon,
  ShieldAlertIcon,
  Trash2Icon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { AllergenGrid } from '@/components/backoffice/catalog/allergen-grid';
import {
  allergenListOf,
  type AllergenMap,
  allergenMapOf,
  commitAmountOnEnter,
  filledLabels,
  type LabelDraft,
  labelDraftOf,
  labelsInput,
  move,
  nameTranslationsInput,
  newRowKey,
} from '@/components/backoffice/catalog/catalog-data';
import { SelectionFields, selectionValid } from '@/components/backoffice/catalog/selection-fields';
import { LabelFields } from '@/components/backoffice/catalog/translation-fields';
import { useDraft } from '@/components/backoffice/catalog/use-draft';
import { ChfInput } from '@/components/backoffice/chf-input';
import { PageHeader } from '@/components/backoffice/page-header';
import { useServerAction } from '@/components/backoffice/use-server-action';
import * as actions from '../actions';
import { useMoney } from '@/components/money';

type Permissions = { manage: boolean; priceChange: boolean };

/** Editor of one modifier group (RF-B02, RF-B05, RF-B07). */
export function ModifierGroupEditor({
  group,
  permissions,
}: {
  group: catalog.ModifierGroupDto;
  permissions: Permissions;
}) {
  const t = useTranslations('modifiers');
  const tc = useTranslations('common');
  const router = useRouter();
  const remove = useServerAction(() => actions.deleteModifierGroup(group.id), {
    successMessage: t('deleted'),
    onSuccess: () => router.push('/backoffice/catalog/modifiers'),
  });

  return (
    <>
      <Link
        href="/backoffice/catalog/modifiers"
        className="mb-3 inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" /> {t('back')}
      </Link>
      <PageHeader
        title={group.name}
        description={`${t('selection', { min: group.minSelect, max: group.maxSelect })} · ${
          group.minSelect > 0 ? t('required') : t('optional')
        }`}
        actions={
          permissions.manage ? (
            <ConfirmButton
              variant="outline"
              disabled={remove.pending}
              title={t('deleteTitle', { name: group.name })}
              description={t('deleteText')}
              confirmLabel={tc('delete')}
              cancelLabel={tc('cancel')}
              onConfirm={() => remove.run()}
            >
              <Trash2Icon /> {tc('delete')}
            </ConfirmButton>
          ) : null
        }
      />
      <div className="grid gap-6">
        {permissions.manage ? null : <Alert variant="info">{t('readOnly')}</Alert>}
        <GroupCard group={group} permissions={permissions} />
        <OptionsCard group={group} permissions={permissions} />
        <GroupTranslationsCard group={group} permissions={permissions} />
      </div>
    </>
  );
}

// ── The group ───────────────────────────────────────────────────────────────

const groupOf = (group: catalog.ModifierGroupDto) => ({
  name: group.name,
  minSelect: group.minSelect,
  maxSelect: group.maxSelect,
  sortOrder: group.sortOrder,
  isActive: group.isActive,
});

function GroupCard({
  group,
  permissions,
}: {
  group: catalog.ModifierGroupDto;
  permissions: Permissions;
}) {
  const t = useTranslations('modifiers');
  const tc = useTranslations('common');
  const { draft, dirty, setDraft, reset } = useDraft(groupOf(group));
  const save = useServerAction(
    (input: ReturnType<typeof groupOf>) =>
      actions.updateModifierGroup(group.id, { ...input, name: input.name.trim() }),
    { onSuccess: (saved) => reset(groupOf(saved)) },
  );
  const canEdit = permissions.manage;
  const valid = selectionValid(draft.minSelect, draft.maxSelect);

  return (
    <Card>
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) void save.run(draft);
        }}
      >
        <CardHeader>
          <CardTitle>{t('group')}</CardTitle>
          <CardDescription>{t('groupHint')}</CardDescription>
        </CardHeader>
        <CardContent className="md:grid-cols-2">
          <Field label={tc('name')} htmlFor="group-name" error={save.fieldErrors.name}>
            <Input
              id="group-name"
              required
              maxLength={100}
              value={draft.name}
              disabled={!canEdit}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            />
          </Field>
          <Field label={tc('sortOrder')} htmlFor="group-sort" error={save.fieldErrors.sortOrder}>
            <Input
              id="group-sort"
              type="number"
              inputMode="numeric"
              min={0}
              value={draft.sortOrder}
              disabled={!canEdit}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  sortOrder: Math.max(0, Math.trunc(Number(e.target.value) || 0)),
                }))
              }
            />
          </Field>
          <SelectionFields
            min={draft.minSelect}
            max={draft.maxSelect}
            disabled={!canEdit}
            errors={save.fieldErrors}
            onChange={({ min, max }) => setDraft((d) => ({ ...d, minSelect: min, maxSelect: max }))}
          />
          <div className="flex items-start gap-3 self-center">
            <Switch
              id="group-active"
              className="mt-0.5"
              checked={draft.isActive}
              disabled={!canEdit}
              onCheckedChange={(isActive) => setDraft((d) => ({ ...d, isActive }))}
            />
            <div className="grid gap-1">
              <Label htmlFor="group-active">{tc('active')}</Label>
              <p className="text-sm text-muted-foreground">{t('activeHint')}</p>
            </div>
          </div>
        </CardContent>
        {canEdit ? (
          <CardFooter>
            {dirty ? (
              <Button type="button" variant="outline" onClick={() => reset()}>
                {t('discard')}
              </Button>
            ) : null}
            <Button type="submit" disabled={save.pending || !dirty || !valid}>
              {save.pending ? tc('saving') : tc('save')}
            </Button>
          </CardFooter>
        ) : null}
      </form>
    </Card>
  );
}

// ── Options ─────────────────────────────────────────────────────────────────

type OptionRow = {
  key: string;
  id?: string;
  name: string;
  priceDeltaRappen: number | null;
  isActive: boolean;
  allergens: AllergenMap;
  labels: LabelDraft;
};

const optionsOf = (group: catalog.ModifierGroupDto): OptionRow[] =>
  group.modifiers.map((m) => ({
    key: m.id,
    id: m.id,
    name: m.name,
    priceDeltaRappen: m.priceDeltaRappen,
    isActive: m.isActive,
    allergens: allergenMapOf(m.allergens),
    labels: labelDraftOf(m.translations),
  }));

function OptionsCard({
  group,
  permissions,
}: {
  group: catalog.ModifierGroupDto;
  permissions: Permissions;
}) {
  const money = useMoney();
  const t = useTranslations('modifiers');
  const tc = useTranslations('common');
  const { draft: rows, dirty, setDraft: setRows, reset } = useDraft(optionsOf(group));
  const [attempted, setAttempted] = useState(false);
  const [editing, setEditing] = useState<{ index: number; part: 'allergens' | 'labels' } | null>(
    null,
  );
  const save = useServerAction((input: unknown) => actions.replaceModifiers(group.id, input), {
    onSuccess: (saved) => {
      setAttempted(false);
      reset(optionsOf(saved));
    },
  });
  const canEdit = permissions.manage;
  const canPrice = canEdit && permissions.priceChange;
  const update = (index: number, patch: Partial<OptionRow>) =>
    setRows((list) => list.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const invalid = rows.some((row) => !row.name.trim() || row.priceDeltaRappen === null);
  const current = editing ? rows[editing.index] : undefined;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (invalid) return;
    void save.run({
      modifiers: rows.map((row, index) => ({
        id: row.id,
        name: row.name.trim(),
        priceDeltaRappen: row.priceDeltaRappen,
        sortOrder: index,
        isActive: row.isActive,
        allergens: allergenListOf(row.allergens),
        translations: labelsInput(row.labels),
      })),
    });
  };

  return (
    <Card>
      <form className="grid gap-4" onSubmit={submit}>
        <CardHeader>
          <CardTitle>{t('options')}</CardTitle>
          <CardDescription>{t('optionsHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          {canEdit && !permissions.priceChange ? (
            <Alert variant="info">{t('noPricePermission')}</Alert>
          ) : null}
          {rows.length === 0 ? (
            <p className="text-muted-foreground">{t('noOptions')}</p>
          ) : (
            <ul className="grid gap-3">
              {rows.map((row, index) => {
                const nameError = attempted && !row.name.trim();
                const priceError = attempted && row.priceDeltaRappen === null;
                const allergenCount = allergenListOf(row.allergens).length;
                const languages = filledLabels(row.labels);
                return (
                  <li
                    key={row.key}
                    className="grid gap-3 rounded-lg border p-3 md:grid-cols-[minmax(0,1fr)_10rem_auto] md:items-end"
                  >
                    <Field
                      label={t('optionName')}
                      htmlFor={`option-${row.key}-name`}
                      error={
                        nameError ? t('nameRequired') : save.fieldErrors[`modifiers.${index}.name`]
                      }
                    >
                      <Input
                        id={`option-${row.key}-name`}
                        maxLength={100}
                        value={row.name}
                        disabled={!canEdit}
                        aria-invalid={nameError}
                        onChange={(e) => update(index, { name: e.target.value })}
                      />
                    </Field>
                    <Field
                      label={t('surcharge')}
                      htmlFor={`option-${row.key}-price`}
                      error={
                        priceError
                          ? t('surchargeRequired')
                          : save.fieldErrors[`modifiers.${index}.priceDeltaRappen`]
                      }
                    >
                      <ChfInput
                        id={`option-${row.key}-price`}
                        value={row.priceDeltaRappen}
                        disabled={!canPrice}
                        aria-invalid={priceError}
                        onKeyDown={commitAmountOnEnter}
                        onValueChange={(priceDeltaRappen) => update(index, { priceDeltaRappen })}
                      />
                    </Field>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                      <div className="flex min-h-11 items-center gap-2">
                        <Switch
                          id={`option-${row.key}-active`}
                          checked={row.isActive}
                          disabled={!canEdit}
                          onCheckedChange={(isActive) => update(index, { isActive })}
                        />
                        <Label htmlFor={`option-${row.key}-active`}>{tc('active')}</Label>
                      </div>
                      <div className="flex items-center">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`${t('allergens')}: ${row.name}`}
                          onClick={() => setEditing({ index, part: 'allergens' })}
                        >
                          <ShieldAlertIcon />
                        </Button>
                        {allergenCount > 0 ? (
                          <Badge variant="warning">{allergenCount}</Badge>
                        ) : null}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`${t('translations')}: ${row.name}`}
                          onClick={() => setEditing({ index, part: 'labels' })}
                        >
                          <LanguagesIcon />
                        </Button>
                        {languages.length > 0 ? (
                          <Badge variant="secondary" className="uppercase">
                            {languages.join(' ')}
                          </Badge>
                        ) : null}
                        {canEdit ? (
                          <>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={t('moveUp')}
                              disabled={index === 0}
                              onClick={() => setRows((list) => move(list, index, -1))}
                            >
                              <ArrowUpIcon />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={t('moveDown')}
                              disabled={index === rows.length - 1}
                              onClick={() => setRows((list) => move(list, index, 1))}
                            >
                              <ArrowDownIcon />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={`${tc('delete')}: ${row.name}`}
                              onClick={() => setRows((list) => list.filter((_, i) => i !== index))}
                            >
                              <Trash2Icon />
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </div>
                    {row.priceDeltaRappen ? (
                      <p className="text-sm text-muted-foreground md:col-span-3">
                        {t('surchargeShown', {
                          price: money.format(row.priceDeltaRappen),
                        })}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          {save.fieldErrors.modifiers ? (
            <p className="text-sm text-destructive" role="alert">
              {save.fieldErrors.modifiers}
            </p>
          ) : null}
        </CardContent>
        {canEdit ? (
          <CardFooter className="justify-between">
            <Button
              type="button"
              variant="outline"
              disabled={rows.length >= 50}
              onClick={() =>
                setRows((list) => [
                  ...list,
                  {
                    key: newRowKey(),
                    name: '',
                    priceDeltaRappen: 0,
                    isActive: true,
                    allergens: {},
                    labels: labelDraftOf(undefined),
                  },
                ])
              }
            >
              <PlusIcon /> {t('addOption')}
            </Button>
            <div className="flex flex-wrap gap-2">
              {dirty ? (
                <Button type="button" variant="outline" onClick={() => reset()}>
                  {t('discard')}
                </Button>
              ) : null}
              <Button type="submit" disabled={save.pending || !dirty}>
                {save.pending ? tc('saving') : tc('save')}
              </Button>
            </div>
          </CardFooter>
        ) : null}
      </form>

      <Dialog open={!!current} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent
          closeLabel={tc('close')}
          className={editing?.part === 'allergens' ? 'sm:max-w-3xl' : undefined}
        >
          {current && editing ? (
            <div className="grid gap-4">
              <DialogHeader>
                <DialogTitle>
                  {editing.part === 'allergens'
                    ? t('allergensOf', { name: current.name || t('newOption') })
                    : t('translationsOf', { name: current.name || t('newOption') })}
                </DialogTitle>
                <DialogDescription>
                  {editing.part === 'allergens' ? t('allergensHint') : t('translationsHint')}
                </DialogDescription>
              </DialogHeader>
              {editing.part === 'allergens' ? (
                <AllergenGrid
                  idPrefix={`option-${current.key}-allergen`}
                  value={current.allergens}
                  disabled={!canEdit}
                  onChange={(allergens) => update(editing.index, { allergens })}
                />
              ) : (
                <LabelFields
                  idPrefix={`option-${current.key}-label`}
                  value={current.labels}
                  disabled={!canEdit}
                  onChange={(labels) => update(editing.index, { labels })}
                />
              )}
              <p className="text-sm text-muted-foreground">{t('applyHint')}</p>
              <DialogFooter>
                <Button type="button" onClick={() => setEditing(null)}>
                  {t('apply')}
                </Button>
              </DialogFooter>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ── Translations of the group name ──────────────────────────────────────────

const groupLabelsOf = (group: catalog.ModifierGroupDto) =>
  labelDraftOf(
    Object.fromEntries(
      Object.entries(group.translations).map(([language, texts]) => [language, texts?.name]),
    ),
  );

function GroupTranslationsCard({
  group,
  permissions,
}: {
  group: catalog.ModifierGroupDto;
  permissions: Permissions;
}) {
  const t = useTranslations('modifiers');
  const tc = useTranslations('common');
  const { draft, dirty, setDraft, reset } = useDraft(groupLabelsOf(group));
  const save = useServerAction(
    (labels: LabelDraft) =>
      actions.replaceModifierGroupTranslations(group.id, nameTranslationsInput(labels)),
    { onSuccess: (saved) => reset(groupLabelsOf(saved)) },
  );
  const canEdit = permissions.manage;

  return (
    <Card>
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save.run(draft);
        }}
      >
        <CardHeader>
          <CardTitle>{t('groupTranslations')}</CardTitle>
          <CardDescription>{t('groupTranslationsHint', { name: group.name })}</CardDescription>
        </CardHeader>
        <CardContent className="max-w-xl">
          <LabelFields
            idPrefix="group-label"
            value={draft}
            disabled={!canEdit}
            onChange={setDraft}
          />
        </CardContent>
        {canEdit ? (
          <CardFooter>
            {dirty ? (
              <Button type="button" variant="outline" onClick={() => reset()}>
                {t('discard')}
              </Button>
            ) : null}
            <Button type="submit" disabled={save.pending || !dirty}>
              {save.pending ? tc('saving') : tc('save')}
            </Button>
          </CardFooter>
        ) : null}
      </form>
    </Card>
  );
}
