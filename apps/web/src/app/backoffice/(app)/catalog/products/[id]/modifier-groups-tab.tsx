'use client';

import type { catalog } from '@pos/api';
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
import { Field } from '@pos/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@pos/ui/select';
import { ArrowDownIcon, ArrowUpIcon, ExternalLinkIcon, Trash2Icon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { move } from '@/components/backoffice/catalog/catalog-data';
import { useDraft } from '@/components/backoffice/catalog/use-draft';
import { useServerAction } from '@/components/backoffice/use-server-action';
import { replaceModifierGroups } from '../../actions';
import type { TabProps } from './editor-shared';

/** Modifier groups of the product, in the order the POS, QR and web ask them (RF-B02). */
export function ModifierGroupsTab({
  product,
  permissions,
  modifierGroups,
}: TabProps & { modifierGroups: catalog.ModifierGroupDto[] }) {
  const t = useTranslations('productModifiers');
  const tm = useTranslations('modifiers');
  const te = useTranslations('productEditor');
  const tc = useTranslations('common');
  const { draft: ids, dirty, setDraft: setIds, reset } = useDraft(product.modifierGroupIds);
  const save = useServerAction((input: unknown) => replaceModifierGroups(product.id, input), {
    onSuccess: (saved) => reset(saved.modifierGroupIds),
  });
  const canEdit = permissions.manage;
  const groupById = new Map(modifierGroups.map((group) => [group.id, group]));
  const available = modifierGroups.filter((group) => !ids.includes(group.id));

  return (
    <Card>
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save.run({ modifierGroupIds: ids });
        }}
      >
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('hint')}</CardDescription>
        </CardHeader>
        <CardContent>
          {ids.length === 0 ? (
            <p className="text-muted-foreground">{t('empty')}</p>
          ) : (
            <ol className="grid gap-2">
              {ids.map((id, index) => {
                const group = groupById.get(id);
                return (
                  <li
                    key={id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
                  >
                    <div className="grid gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-muted-foreground tabular-nums">{index + 1}.</span>
                        <span className="font-medium">{group?.name ?? t('unknown')}</span>
                        {group ? (
                          <Badge variant={group.minSelect > 0 ? 'default' : 'secondary'}>
                            {group.minSelect > 0 ? tm('required') : tm('optional')}
                          </Badge>
                        ) : null}
                        {group && !group.isActive ? (
                          <Badge variant="outline">{tc('inactive')}</Badge>
                        ) : null}
                      </div>
                      {group ? (
                        <p className="text-sm text-muted-foreground">
                          {tm('selection', { min: group.minSelect, max: group.maxSelect })} ·{' '}
                          {group.modifiers.map((m) => m.name).join(', ') || tm('noOptions')}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex items-center">
                      <Button variant="ghost" size="icon" asChild>
                        <Link
                          href={`/backoffice/catalog/modifiers/${id}`}
                          aria-label={`${tc('edit')}: ${group?.name ?? ''}`}
                        >
                          <ExternalLinkIcon />
                        </Link>
                      </Button>
                      {canEdit ? (
                        <>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={te('moveUp')}
                            disabled={index === 0}
                            onClick={() => setIds((list) => move(list, index, -1))}
                          >
                            <ArrowUpIcon />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={te('moveDown')}
                            disabled={index === ids.length - 1}
                            onClick={() => setIds((list) => move(list, index, 1))}
                          >
                            <ArrowDownIcon />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={`${t('remove')}: ${group?.name ?? ''}`}
                            onClick={() => setIds((list) => list.filter((other) => other !== id))}
                          >
                            <Trash2Icon />
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          {canEdit ? (
            available.length > 0 ? (
              <Field label={t('add')} className="max-w-md">
                <Select value="" onValueChange={(id) => setIds((list) => [...list, id])}>
                  <SelectTrigger aria-label={t('add')}>
                    <SelectValue placeholder={t('choose')} />
                  </SelectTrigger>
                  <SelectContent>
                    {available.map((group) => (
                      <SelectItem key={group.id} value={group.id}>
                        {group.name} (
                        {tm('selection', { min: group.minSelect, max: group.maxSelect })})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            ) : (
              <p className="text-sm text-muted-foreground">
                {modifierGroups.length === 0 ? t('noGroups') : t('allLinked')}{' '}
                <Link href="/backoffice/catalog/modifiers" className="underline">
                  {t('manageGroups')}
                </Link>
              </p>
            )
          ) : null}
          {save.fieldErrors.modifierGroupIds ? (
            <p className="text-sm text-destructive" role="alert">
              {save.fieldErrors.modifierGroupIds}
            </p>
          ) : null}
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
