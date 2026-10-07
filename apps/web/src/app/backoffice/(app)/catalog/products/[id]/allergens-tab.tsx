'use client';

import type { catalog } from '@pos/api';
import { ORIGIN_KINDS, type OriginKind } from '@pos/core';
import { Alert } from '@pos/ui/alert';
import { Button } from '@pos/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@pos/ui/card';
import { Input } from '@pos/ui/input';
import { Field, Label } from '@pos/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@pos/ui/select';
import { Checkbox } from '@pos/ui/switch';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { AllergenGrid } from '@/components/backoffice/catalog/allergen-grid';
import {
  allergenListOf,
  allergenMapOf,
  COMMON_COUNTRIES,
  countryName,
  newRowKey,
} from '@/components/backoffice/catalog/catalog-data';
import { useDraft } from '@/components/backoffice/catalog/use-draft';
import { useServerAction } from '@/components/backoffice/use-server-action';
import { replaceAllergens, replaceOrigins } from '../../actions';
import type { TabProps } from './editor-shared';

/** Allergens (RF-B05) and origin of meat, poultry and fish (RF-B06): both gate QR and web (RN-18). */
export function AllergensTab({ product, permissions }: TabProps) {
  return (
    <div className="grid gap-6">
      <AllergensCard product={product} permissions={permissions} />
      <OriginsCard product={product} permissions={permissions} />
    </div>
  );
}

const allergensOf = (product: catalog.ProductDto) => ({
  allergens: allergenMapOf(product.allergens),
  confirmed: product.allergensComplete,
});

function AllergensCard({ product, permissions }: TabProps) {
  const t = useTranslations('productAllergens');
  const te = useTranslations('productEditor');
  const tc = useTranslations('common');
  const { draft, dirty, setDraft, reset } = useDraft(allergensOf(product));
  const save = useServerAction((input: unknown) => replaceAllergens(product.id, input), {
    onSuccess: (saved) => reset(allergensOf(saved)),
  });
  const canEdit = permissions.manage;

  return (
    <Card>
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save.run({ allergens: allergenListOf(draft.allergens), confirmed: draft.confirmed });
        }}
      >
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('hint')}</CardDescription>
        </CardHeader>
        <CardContent>
          <AllergenGrid
            idPrefix="product-allergen"
            value={draft.allergens}
            disabled={!canEdit}
            onChange={(allergens) => setDraft((d) => ({ ...d, allergens }))}
          />
          <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-4">
            <Checkbox
              id="allergens-confirmed"
              className="mt-0.5"
              checked={draft.confirmed}
              disabled={!canEdit}
              onCheckedChange={(checked) =>
                setDraft((d) => ({ ...d, confirmed: checked === true }))
              }
            />
            <div className="grid gap-1">
              <Label htmlFor="allergens-confirmed">{t('confirmed')}</Label>
              <p className="text-sm text-muted-foreground">{t('confirmedHint')}</p>
            </div>
          </div>
          {!draft.confirmed ? <Alert variant="warning">{t('notConfirmed')}</Alert> : null}
        </CardContent>
        {canEdit ? (
          <CardFooter>
            {dirty ? (
              <Button type="button" variant="outline" onClick={() => reset()}>
                {te('discard')}
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

const OTHER = 'other';

type OriginRow = {
  key: string;
  id?: string;
  kind: OriginKind;
  species: string;
  country: string;
};

const originsOf = (product: catalog.ProductDto): OriginRow[] =>
  product.origins.map((o) => ({
    key: o.id,
    id: o.id,
    kind: (ORIGIN_KINDS as readonly string[]).includes(o.kind) ? (o.kind as OriginKind) : 'meat',
    species: o.species ?? '',
    country: o.country,
  }));

const validCountry = (code: string) => /^[A-Z]{2}$/.test(code);

function OriginsCard({ product, permissions }: TabProps) {
  const t = useTranslations('origins');
  const tk = useTranslations('originKinds');
  const te = useTranslations('productEditor');
  const tc = useTranslations('common');
  const locale = useLocale();
  const { draft: rows, dirty, setDraft: setRows, reset } = useDraft(originsOf(product));
  /** Rows whose country is typed by hand instead of picked from the list. */
  const [typed, setTyped] = useState<Set<string>>(() => new Set());
  const [attempted, setAttempted] = useState(false);
  const save = useServerAction((input: unknown) => replaceOrigins(product.id, input), {
    onSuccess: (saved) => {
      setAttempted(false);
      reset(originsOf(saved));
    },
  });
  const canEdit = permissions.manage;
  const update = (index: number, patch: Partial<OriginRow>) =>
    setRows((list) => list.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const invalid = rows.some((row) => !validCountry(row.country));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (invalid) return;
    void save.run({
      origins: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        species: row.species.trim() || null,
        country: row.country,
      })),
    });
  };

  return (
    <Card>
      <form className="grid gap-4" onSubmit={submit}>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('hint')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert
            variant={product.requiresOrigin && product.origins.length === 0 ? 'warning' : 'info'}
          >
            {product.requiresOrigin ? t('required') : t('notRequired')}
          </Alert>
          {rows.length === 0 ? (
            <p className="text-muted-foreground">{t('empty')}</p>
          ) : (
            <ul className="grid gap-3">
              {rows.map((row, index) => {
                const listed = (COMMON_COUNTRIES as readonly string[]).includes(row.country);
                const manual = typed.has(row.key) || (!listed && row.country !== '');
                const countryError = attempted && !validCountry(row.country);
                return (
                  <li
                    key={row.key}
                    className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-[10rem_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end"
                  >
                    <Field label={t('kind')}>
                      <Select
                        value={row.kind}
                        disabled={!canEdit}
                        onValueChange={(value) => update(index, { kind: value as OriginKind })}
                      >
                        <SelectTrigger aria-label={t('kind')}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ORIGIN_KINDS.map((kind) => (
                            <SelectItem key={kind} value={kind}>
                              {tk(kind)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field
                      label={t('species')}
                      htmlFor={`origin-${row.key}-species`}
                      hint={t('speciesHint')}
                    >
                      <Input
                        id={`origin-${row.key}-species`}
                        maxLength={64}
                        value={row.species}
                        disabled={!canEdit}
                        onChange={(e) => update(index, { species: e.target.value })}
                      />
                    </Field>
                    <Field
                      label={t('country')}
                      htmlFor={manual ? `origin-${row.key}-country` : undefined}
                      error={
                        countryError
                          ? t('countryInvalid')
                          : save.fieldErrors[`origins.${index}.country`]
                      }
                    >
                      <div className="grid gap-2">
                        <Select
                          value={manual ? OTHER : row.country}
                          disabled={!canEdit}
                          onValueChange={(value) => {
                            const next = new Set(typed);
                            if (value === OTHER) {
                              next.add(row.key);
                              update(index, { country: '' });
                            } else {
                              next.delete(row.key);
                              update(index, { country: value });
                            }
                            setTyped(next);
                          }}
                        >
                          <SelectTrigger aria-label={t('country')} aria-invalid={countryError}>
                            <SelectValue placeholder={t('chooseCountry')} />
                          </SelectTrigger>
                          <SelectContent>
                            {COMMON_COUNTRIES.map((code) => (
                              <SelectItem key={code} value={code}>
                                {countryName(code, locale)} ({code})
                              </SelectItem>
                            ))}
                            <SelectItem value={OTHER}>{t('otherCountry')}</SelectItem>
                          </SelectContent>
                        </Select>
                        {manual ? (
                          <Input
                            id={`origin-${row.key}-country`}
                            maxLength={2}
                            autoCapitalize="characters"
                            className="font-mono uppercase"
                            placeholder={t('countryPlaceholder')}
                            value={row.country}
                            disabled={!canEdit}
                            aria-invalid={countryError}
                            aria-describedby={`origin-${row.key}-country-name`}
                            onChange={(e) =>
                              update(index, {
                                country: e.target.value.toUpperCase().replace(/[^A-Z]/g, ''),
                              })
                            }
                          />
                        ) : null}
                        {manual && validCountry(row.country) ? (
                          <p
                            id={`origin-${row.key}-country-name`}
                            className="text-sm text-muted-foreground"
                          >
                            {countryName(row.country, locale)}
                          </p>
                        ) : null}
                      </div>
                    </Field>
                    {canEdit ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`${tc('delete')}: ${tk(row.kind)}`}
                        onClick={() => setRows((list) => list.filter((_, i) => i !== index))}
                      >
                        <Trash2Icon />
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
        {canEdit ? (
          <CardFooter className="justify-between">
            <Button
              type="button"
              variant="outline"
              disabled={rows.length >= 10}
              onClick={() =>
                setRows((list) => [
                  ...list,
                  { key: newRowKey(), kind: 'meat', species: '', country: 'CH' },
                ])
              }
            >
              <PlusIcon /> {t('add')}
            </Button>
            <div className="flex flex-wrap gap-2">
              {dirty ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setTyped(new Set());
                    reset();
                  }}
                >
                  {te('discard')}
                </Button>
              ) : null}
              <Button type="submit" disabled={save.pending || !dirty}>
                {save.pending ? tc('saving') : tc('save')}
              </Button>
            </div>
          </CardFooter>
        ) : null}
      </form>
    </Card>
  );
}
