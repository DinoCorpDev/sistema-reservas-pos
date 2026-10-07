'use client';

import type { catalog } from '@pos/api';
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
import { Field } from '@pos/ui/label';
import { Switch } from '@pos/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@pos/ui/table';
import { PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { SelectionFields, selectionValid } from '@/components/backoffice/catalog/selection-fields';
import { useServerAction } from '@/components/backoffice/use-server-action';
import * as actions from './actions';

type NewGroup = { name: string; min: number; max: number };

/** List of modifier groups; a new group opens in its editor to add the options. */
export function ModifierGroupsManager({
  groups,
  canEdit,
}: {
  groups: catalog.ModifierGroupDto[];
  canEdit: boolean;
}) {
  const t = useTranslations('modifiers');
  const tc = useTranslations('common');
  const router = useRouter();
  const [draft, setDraft] = useState<NewGroup | null>(null);

  const create = useServerAction(
    (value: NewGroup) =>
      actions.createModifierGroup({
        name: value.name.trim(),
        minSelect: value.min,
        maxSelect: value.max,
        sortOrder: groups.length,
      }),
    {
      successMessage: t('created'),
      onSuccess: (group) => {
        setDraft(null);
        router.push(`/backoffice/catalog/modifiers/${group.id}`);
      },
    },
  );
  const toggle = useServerAction((id: string, isActive: boolean) =>
    actions.updateModifierGroup(id, { isActive }),
  );
  const remove = useServerAction(actions.deleteModifierGroup, { successMessage: t('deleted') });

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <div className="grid gap-1">
            <CardTitle>{t('groups')}</CardTitle>
            <CardDescription>{t('groupsHint')}</CardDescription>
          </div>
          {canEdit ? (
            <Button onClick={() => setDraft({ name: '', min: 0, max: 1 })}>
              <PlusIcon /> {t('new')}
            </Button>
          ) : null}
        </CardHeader>
        {groups.length === 0 ? (
          <p className="text-muted-foreground">{t('empty')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tc('name')}</TableHead>
                <TableHead>{t('selectionLabel')}</TableHead>
                <TableHead>{t('options')}</TableHead>
                <TableHead>{tc('active')}</TableHead>
                <TableHead className="text-right">{tc('actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((group) => (
                <TableRow key={group.id}>
                  <TableCell>
                    <Link
                      href={`/backoffice/catalog/modifiers/${group.id}`}
                      className="font-medium hover:underline"
                    >
                      {group.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="tabular-nums">
                        {t('range', { min: group.minSelect, max: group.maxSelect })}
                      </span>
                      {group.minSelect > 0 ? (
                        <Badge>{t('required')}</Badge>
                      ) : (
                        <Badge variant="secondary">{t('optional')}</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-xs">
                    <span className="line-clamp-2 text-muted-foreground">
                      {group.modifiers.length === 0
                        ? t('noOptions')
                        : group.modifiers.map((m) => m.name).join(', ')}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={group.isActive}
                      disabled={!canEdit || toggle.pending}
                      onCheckedChange={(checked) => void toggle.run(group.id, checked)}
                      aria-label={`${tc('active')}: ${group.name}`}
                    />
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button variant="ghost" size="icon" asChild>
                      <Link
                        href={`/backoffice/catalog/modifiers/${group.id}`}
                        aria-label={`${canEdit ? tc('edit') : tc('details')}: ${group.name}`}
                      >
                        <PencilIcon />
                      </Link>
                    </Button>
                    {canEdit ? (
                      <ConfirmButton
                        variant="ghost"
                        size="icon"
                        aria-label={`${tc('delete')}: ${group.name}`}
                        disabled={remove.pending}
                        title={t('deleteTitle', { name: group.name })}
                        description={t('deleteText')}
                        confirmLabel={tc('delete')}
                        cancelLabel={tc('cancel')}
                        onConfirm={() => remove.run(group.id)}
                      >
                        <Trash2Icon />
                      </ConfirmButton>
                    ) : null}
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
                if (selectionValid(draft.min, draft.max)) void create.run(draft);
              }}
            >
              <DialogHeader>
                <DialogTitle>{t('new')}</DialogTitle>
                <DialogDescription>{t('newHint')}</DialogDescription>
              </DialogHeader>
              <Field label={tc('name')} htmlFor="group-name" error={create.fieldErrors.name}>
                <Input
                  id="group-name"
                  required
                  autoFocus
                  maxLength={100}
                  placeholder={t('namePlaceholder')}
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </Field>
              <SelectionFields
                min={draft.min}
                max={draft.max}
                errors={create.fieldErrors}
                onChange={({ min, max }) => setDraft({ ...draft, min, max })}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDraft(null)}>
                  {tc('cancel')}
                </Button>
                <Button
                  type="submit"
                  disabled={create.pending || !selectionValid(draft.min, draft.max)}
                >
                  {create.pending ? tc('saving') : tc('create')}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
