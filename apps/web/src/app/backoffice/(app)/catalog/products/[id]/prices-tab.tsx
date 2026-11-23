'use client';

import type { catalog } from '@pos/api';
import { type Channel, CHANNELS } from '@pos/core';
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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@pos/ui/dialog';
import { Input } from '@pos/ui/input';
import { Field, Label } from '@pos/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@pos/ui/select';
import { Checkbox, Switch } from '@pos/ui/switch';
import { EmptyState } from '@pos/ui/empty-state';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  LanguagesIcon,
  PlusIcon,
  TagIcon,
  Trash2Icon,
} from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  commitAmountOnEnter,
  filledLabels,
  labelDraftOf,
  labelsInput,
  type LabelDraft,
  move,
  newRowKey,
} from '@/components/backoffice/catalog/catalog-data';
import { LabelFields } from '@/components/backoffice/catalog/translation-fields';
import { useDraft } from '@/components/backoffice/catalog/use-draft';
import { ChfInput } from '@/components/backoffice/chf-input';
import { useServerAction } from '@/components/backoffice/use-server-action';
import { replaceChannelPrices, replaceVariants, updateLocationSettings } from '../../actions';
import { SoldOutButton } from '../../sold-out-button';
import type { EditorLocation, TabProps } from './editor-shared';
import { useMoney } from '@/components/money';

const EVERYWHERE = 'all';
const NO_VARIANT = 'none';

/** Variants (RF-B02), prices per channel (RF-B04) and the product at this location (RF-B01). */
export function PricesTab({
  product,
  permissions,
  locations,
  location,
}: TabProps & { locations: { id: string; name: string }[]; location: EditorLocation | null }) {
  const t = useTranslations('productEditor');
  return (
    <div className="grid gap-6">
      {permissions.manage && !permissions.priceChange ? (
        <Alert variant="info">{t('noPricePermission')}</Alert>
      ) : null}
      <VariantsCard product={product} permissions={permissions} />
      <ChannelPricesCard product={product} permissions={permissions} locations={locations} />
      <LocationCard product={product} permissions={permissions} location={location} />
    </div>
  );
}

// ── Variants ────────────────────────────────────────────────────────────────

type VariantRow = {
  key: string;
  id?: string;
  name: string;
  priceRappen: number | null;
  isDefault: boolean;
  isActive: boolean;
  labels: LabelDraft;
};

const variantsOf = (product: catalog.ProductDto): VariantRow[] =>
  product.variants.map((v) => ({
    key: v.id,
    id: v.id,
    name: v.name,
    priceRappen: v.priceRappen,
    isDefault: v.isDefault,
    isActive: v.isActive,
    labels: labelDraftOf(v.translations),
  }));

function VariantsCard({ product, permissions }: TabProps) {
  const t = useTranslations('variants');
  const te = useTranslations('productEditor');
  const tc = useTranslations('common');
  const { draft: rows, dirty, setDraft: setRows, reset } = useDraft(variantsOf(product));
  const [attempted, setAttempted] = useState(false);
  const [labelsOf, setLabelsOf] = useState<number | null>(null);
  const save = useServerAction((input: unknown) => replaceVariants(product.id, input), {
    onSuccess: (saved) => {
      setAttempted(false);
      reset(variantsOf(saved));
    },
  });
  const canEdit = permissions.manage;
  const canPrice = canEdit && permissions.priceChange;
  const update = (index: number, patch: Partial<VariantRow>) =>
    setRows((list) => list.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const invalid = rows.some((row) => !row.name.trim() || row.priceRappen === null);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (invalid) return;
    void save.run({
      variants: rows.map((row, index) => ({
        id: row.id,
        name: row.name.trim(),
        priceRappen: row.priceRappen,
        isDefault: row.isDefault,
        sortOrder: index,
        isActive: row.isActive,
        translations: labelsInput(row.labels),
      })),
    });
  };

  const editing = labelsOf === null ? undefined : rows[labelsOf];

  return (
    <Card>
      <form onSubmit={submit} className="grid gap-4">
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('hint')}</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState compact icon={<TagIcon />} title={t('empty')} />
          ) : (
            <ul className="grid gap-3">
              {rows.map((row, index) => {
                const nameError = attempted && !row.name.trim();
                const priceError = attempted && row.priceRappen === null;
                const languages = filledLabels(row.labels);
                return (
                  <li
                    key={row.key}
                    className="grid gap-3 rounded-lg border p-3 md:grid-cols-[minmax(0,1fr)_10rem_auto] md:items-end"
                  >
                    <Field
                      label={t('name')}
                      htmlFor={`variant-${row.key}-name`}
                      error={
                        nameError ? t('nameRequired') : save.fieldErrors[`variants.${index}.name`]
                      }
                    >
                      <Input
                        id={`variant-${row.key}-name`}
                        maxLength={100}
                        placeholder={t('namePlaceholder')}
                        value={row.name}
                        disabled={!canEdit}
                        aria-invalid={nameError}
                        onChange={(e) => update(index, { name: e.target.value })}
                      />
                    </Field>
                    <Field
                      label={t('price')}
                      htmlFor={`variant-${row.key}-price`}
                      error={
                        priceError
                          ? t('priceRequired')
                          : save.fieldErrors[`variants.${index}.priceRappen`]
                      }
                    >
                      <ChfInput
                        id={`variant-${row.key}-price`}
                        value={row.priceRappen}
                        disabled={!canPrice}
                        aria-invalid={priceError}
                        onKeyDown={commitAmountOnEnter}
                        onValueChange={(priceRappen) => update(index, { priceRappen })}
                      />
                    </Field>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      <div className="flex min-h-11 items-center gap-2">
                        <Checkbox
                          id={`variant-${row.key}-default`}
                          checked={row.isDefault}
                          disabled={!canEdit}
                          onCheckedChange={(checked) =>
                            checked === true &&
                            setRows((list) =>
                              list.map((r, i) => ({ ...r, isDefault: i === index })),
                            )
                          }
                        />
                        <Label htmlFor={`variant-${row.key}-default`}>{t('default')}</Label>
                      </div>
                      <div className="flex min-h-11 items-center gap-2">
                        <Switch
                          id={`variant-${row.key}-active`}
                          checked={row.isActive}
                          disabled={!canEdit}
                          onCheckedChange={(isActive) => update(index, { isActive })}
                        />
                        <Label htmlFor={`variant-${row.key}-active`}>{tc('active')}</Label>
                      </div>
                      <div className="flex items-center">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`${t('translations')}: ${row.name}`}
                          onClick={() => setLabelsOf(index)}
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
                              aria-label={te('moveUp')}
                              disabled={index === 0}
                              onClick={() => setRows((list) => move(list, index, -1))}
                            >
                              <ArrowUpIcon />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={te('moveDown')}
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
                  </li>
                );
              })}
            </ul>
          )}
          {save.fieldErrors.variants ? (
            <p className="text-sm text-destructive" role="alert">
              {save.fieldErrors.variants}
            </p>
          ) : null}
        </CardContent>
        {canEdit ? (
          <CardFooter className="justify-between">
            <Button
              type="button"
              variant="outline"
              disabled={!canPrice}
              onClick={() =>
                setRows((list) => [
                  ...list,
                  {
                    key: newRowKey(),
                    name: '',
                    priceRappen: list.length === 0 ? product.basePriceRappen : null,
                    isDefault: list.length === 0,
                    isActive: true,
                    labels: labelDraftOf(undefined),
                  },
                ])
              }
            >
              <PlusIcon /> {t('add')}
            </Button>
            <div className="flex flex-wrap gap-2">
              {dirty ? (
                <Button type="button" variant="outline" onClick={() => reset()}>
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

      <Dialog open={!!editing} onOpenChange={(open) => !open && setLabelsOf(null)}>
        <DialogContent closeLabel={tc('close')}>
          {editing && labelsOf !== null ? (
            <div className="grid gap-4">
              <DialogHeader>
                <DialogTitle>
                  {t('translationsOf', { name: editing.name || t('newVariant') })}
                </DialogTitle>
              </DialogHeader>
              <LabelFields
                idPrefix={`variant-${editing.key}-label`}
                value={editing.labels}
                disabled={!canEdit}
                onChange={(labels) => update(labelsOf, { labels })}
              />
              <p className="text-sm text-muted-foreground">{te('applyHint')}</p>
              <DialogFooter>
                <Button type="button" onClick={() => setLabelsOf(null)}>
                  {te('apply')}
                </Button>
              </DialogFooter>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ── Channel prices ──────────────────────────────────────────────────────────

type PriceRow = {
  key: string;
  channel: Channel;
  locationId: string | null;
  variantId: string | null;
  priceRappen: number | null;
};

const pricesOf = (product: catalog.ProductDto): PriceRow[] =>
  product.channelPrices.map((p) => ({
    key: p.id,
    channel: p.channel as Channel,
    locationId: p.locationId,
    variantId: p.variantId,
    priceRappen: p.priceRappen,
  }));

const priceKey = (row: PriceRow) => `${row.channel}|${row.locationId}|${row.variantId}`;

function ChannelPricesCard({
  product,
  permissions,
  locations,
}: TabProps & { locations: { id: string; name: string }[] }) {
  const t = useTranslations('channelPrices');
  const te = useTranslations('productEditor');
  const tch = useTranslations('channels');
  const tc = useTranslations('common');
  const { draft: rows, dirty, setDraft: setRows, reset } = useDraft(pricesOf(product));
  const [attempted, setAttempted] = useState(false);
  const save = useServerAction((input: unknown) => replaceChannelPrices(product.id, input), {
    onSuccess: (saved) => {
      setAttempted(false);
      reset(pricesOf(saved));
    },
  });
  const canEdit = permissions.manage && permissions.priceChange;
  const update = (index: number, patch: Partial<PriceRow>) =>
    setRows((list) => list.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(priceKey(row), (counts.get(priceKey(row)) ?? 0) + 1);
  const duplicated = (row: PriceRow) => (counts.get(priceKey(row)) ?? 0) > 1;
  const invalid = rows.some((row) => row.priceRappen === null || duplicated(row));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (invalid) return;
    void save.run({
      prices: rows.map(({ channel, locationId, variantId, priceRappen }) => ({
        channel,
        locationId,
        variantId,
        priceRappen,
      })),
    });
  };

  return (
    <Card>
      <form onSubmit={submit} className="grid gap-4">
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('hint')}</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState compact icon={<TagIcon />} title={t('empty')} />
          ) : (
            <ul className="grid gap-3">
              {rows.map((row, index) => {
                const priceError = attempted && row.priceRappen === null;
                const duplicateError = attempted && duplicated(row);
                return (
                  <li
                    key={row.key}
                    className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-[repeat(3,minmax(0,1fr))_10rem_auto] lg:items-end"
                  >
                    <Field label={t('channel')}>
                      <Select
                        value={row.channel}
                        disabled={!canEdit}
                        onValueChange={(value) => update(index, { channel: value as Channel })}
                      >
                        <SelectTrigger aria-label={t('channel')}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CHANNELS.map((channel) => (
                            <SelectItem key={channel} value={channel}>
                              {tch(channel)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label={t('location')}>
                      <Select
                        value={row.locationId ?? EVERYWHERE}
                        disabled={!canEdit}
                        onValueChange={(value) =>
                          update(index, { locationId: value === EVERYWHERE ? null : value })
                        }
                      >
                        <SelectTrigger aria-label={t('location')}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={EVERYWHERE}>{t('allLocations')}</SelectItem>
                          {locations.map((location) => (
                            <SelectItem key={location.id} value={location.id}>
                              {location.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label={t('variant')}>
                      <Select
                        value={row.variantId ?? NO_VARIANT}
                        disabled={!canEdit || product.variants.length === 0}
                        onValueChange={(value) =>
                          update(index, { variantId: value === NO_VARIANT ? null : value })
                        }
                      >
                        <SelectTrigger aria-label={t('variant')}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_VARIANT}>{t('noVariant')}</SelectItem>
                          {product.variants.map((variant) => (
                            <SelectItem key={variant.id} value={variant.id}>
                              {variant.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field
                      label={t('price')}
                      htmlFor={`price-${row.key}`}
                      error={
                        priceError
                          ? t('priceRequired')
                          : duplicateError
                            ? t('duplicate')
                            : save.fieldErrors[`prices.${index}.priceRappen`]
                      }
                    >
                      <ChfInput
                        id={`price-${row.key}`}
                        value={row.priceRappen}
                        disabled={!canEdit}
                        aria-invalid={priceError || duplicateError}
                        onKeyDown={commitAmountOnEnter}
                        onValueChange={(priceRappen) => update(index, { priceRappen })}
                      />
                    </Field>
                    {canEdit ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`${tc('delete')}: ${tch(row.channel)}`}
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
          {save.fieldErrors.prices ? (
            <p className="text-sm text-destructive" role="alert">
              {save.fieldErrors.prices}
            </p>
          ) : null}
        </CardContent>
        {canEdit ? (
          <CardFooter className="justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setRows((list) => [
                  ...list,
                  {
                    key: newRowKey(),
                    channel: 'takeaway',
                    locationId: null,
                    variantId: null,
                    priceRappen: null,
                  },
                ])
              }
            >
              <PlusIcon /> {t('add')}
            </Button>
            <div className="flex flex-wrap gap-2">
              {dirty ? (
                <Button type="button" variant="outline" onClick={() => reset()}>
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

// ── The product at the current location ─────────────────────────────────────

const locationSettingsOf = (product: catalog.ProductDto) => ({
  isActive: product.locationSettings?.isActive ?? true,
  priceRappen: product.locationSettings?.priceRappen ?? null,
});

function LocationCard({
  product,
  permissions,
  location,
}: TabProps & { location: EditorLocation | null }) {
  const money = useMoney();
  const t = useTranslations('locationSettings');
  const te = useTranslations('productEditor');
  const tc = useTranslations('common');
  const format = useFormatter();
  const { draft, dirty, setDraft, reset } = useDraft(locationSettingsOf(product));
  const save = useServerAction((input: unknown) => updateLocationSettings(product.id, input), {
    onSuccess: (saved) => reset(locationSettingsOf(saved)),
  });

  if (!location || !product.locationSettings) {
    return <Alert variant="info">{t('noLocation')}</Alert>;
  }
  const settings = product.locationSettings;
  const canEdit = permissions.manage;
  const when = (iso: string) =>
    format.dateTime(new Date(iso), {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

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
          <CardTitle>{t('title', { location: location.name })}</CardTitle>
          <CardDescription>{t('hint')}</CardDescription>
        </CardHeader>
        <CardContent className="md:grid-cols-2">
          <div className="flex items-start gap-3">
            <Switch
              id="location-active"
              className="mt-0.5"
              checked={draft.isActive}
              disabled={!canEdit}
              onCheckedChange={(isActive) => setDraft((d) => ({ ...d, isActive }))}
            />
            <div className="grid gap-1">
              <Label htmlFor="location-active">{t('active')}</Label>
              <p className="text-sm text-muted-foreground">{t('activeHint')}</p>
            </div>
          </div>
          <Field
            label={t('price')}
            htmlFor="location-price"
            hint={t('priceHint', { price: money.format(product.basePriceRappen) })}
            error={save.fieldErrors.priceRappen}
          >
            <ChfInput
              id="location-price"
              value={draft.priceRappen}
              placeholder={money.format(product.basePriceRappen, { symbol: false })}
              disabled={!canEdit || !permissions.priceChange}
              onKeyDown={commitAmountOnEnter}
              onValueChange={(priceRappen) => setDraft((d) => ({ ...d, priceRappen }))}
            />
          </Field>
          <div className="grid gap-3 rounded-lg border p-4 md:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="grid gap-1">
                <p className="font-medium">{t('soldOutTitle')}</p>
                <p className="text-sm text-muted-foreground">
                  {settings.isSoldOut
                    ? settings.soldOutUntil
                      ? t('soldOutUntil', { until: when(settings.soldOutUntil) })
                      : t('soldOutOpen')
                    : t('available')}
                </p>
              </div>
              {permissions.soldOut && product.isActive ? (
                <SoldOutButton
                  productId={product.id}
                  productName={product.name}
                  soldOut={settings.isSoldOut}
                />
              ) : null}
            </div>
          </div>
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
