'use client';

import type { people } from '@pos/api';
import { CONTENT_LANGUAGES } from '@pos/core';
import { Badge } from '@pos/ui/badge';
import { Button } from '@pos/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@pos/ui/card';
import { ConfirmButton } from '@pos/ui/confirm';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@pos/ui/dialog';
import { Input } from '@pos/ui/input';
import { Field, Label } from '@pos/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@pos/ui/select';
import { Switch } from '@pos/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@pos/ui/table';
import { EmptyState } from '@pos/ui/empty-state';
import { ChefHatIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useServerAction } from '@/components/backoffice/use-server-action';
import * as actions from './actions';
import { fromOption, NONE, selectable, toOption } from './options';

type StationDraft = {
  id?: string;
  name: string;
  /** Empty = the location's default alert threshold. */
  alertAfterMinutes: string;
  /** NONE = the location's kitchen language. */
  language: string;
  printerId: string;
  /** "If nobody is there, send to…" (DEC-033); NONE = no replacement. */
  fallbackStationId: string;
  sortOrder: number;
  isActive: boolean;
};

type StationDefaults = { alertAfterMinutes: number; language: string };

/**
 * Kitchen stations with their own delay alert, ticket language and printer (RF-A03, RF-C24,
 * RF-C25), and the station that gets their tickets when nobody is there (DEC-033).
 */
export function StationsManager({
  stations,
  printers,
  terminals,
  defaults,
  canEdit,
}: {
  stations: people.KitchenStationDto[];
  printers: people.PrinterDto[];
  terminals: people.TerminalDto[];
  defaults: StationDefaults;
  canEdit: boolean;
}) {
  const t = useTranslations('stations');
  const tc = useTranslations('common');
  const tl = useTranslations('languages');
  const [draft, setDraft] = useState<StationDraft | null>(null);

  const toggle = useServerAction((id: string, isActive: boolean) =>
    actions.updateKitchenStation(id, { isActive }),
  );
  const remove = useServerAction(actions.deleteKitchenStation);
  const printerName = (id: string | null) => printers.find((p) => p.id === id)?.name ?? '—';
  // Where the tickets of a station show up: its kitchen displays and its printer (RF-C20, RF-C26).
  const displaysOf = (stationId: string) =>
    terminals.filter((d) => d.type === 'kds' && d.isActive && d.kitchenStationId === stationId);
  const printsOn = (printerId: string | null) =>
    printers.some((p) => p.id === printerId && p.isActive);
  const fallbackOf = (station: people.KitchenStationDto) =>
    stations.find((s) => s.id === station.fallbackStationId && s.isActive) ?? null;
  const standard = (value: string) => (
    <span className="text-muted-foreground">{t('standard', { value })}</span>
  );

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
        <div className="grid gap-1">
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('hint')}</CardDescription>
        </div>
        {canEdit ? (
          <Button
            onClick={() =>
              setDraft({
                name: '',
                alertAfterMinutes: '',
                language: NONE,
                printerId: NONE,
                fallbackStationId: NONE,
                sortOrder: stations.length,
                isActive: true,
              })
            }
          >
            <PlusIcon /> {t('new')}
          </Button>
        ) : null}
      </CardHeader>
      {stations.length === 0 ? (
        <EmptyState compact icon={<ChefHatIcon />} title={t('empty')} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tc('name')}</TableHead>
              <TableHead>{t('alertAfter')}</TableHead>
              <TableHead>{t('language')}</TableHead>
              <TableHead>{t('printer')}</TableHead>
              <TableHead>{t('displays')}</TableHead>
              <TableHead>{t('fallback')}</TableHead>
              <TableHead>{tc('sortOrder')}</TableHead>
              <TableHead>{tc('active')}</TableHead>
              {canEdit ? <TableHead className="text-right">{tc('actions')}</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {stations.map((station) => (
              <TableRow key={station.id}>
                <TableCell className="font-medium">{station.name}</TableCell>
                <TableCell>
                  {station.alertAfterMinutes !== null
                    ? t('minutes', { minutes: station.alertAfterMinutes })
                    : standard(t('minutes', { minutes: defaults.alertAfterMinutes }))}
                </TableCell>
                <TableCell>
                  {station.language ? tl(station.language) : standard(tl(defaults.language))}
                </TableCell>
                <TableCell>{printerName(station.printerId)}</TableCell>
                <TableCell data-testid="station-output">
                  {displaysOf(station.id).length > 0 ? (
                    displaysOf(station.id)
                      .map((d) => d.name)
                      .join(', ')
                  ) : station.isActive && !printsOn(station.printerId) ? (
                    fallbackOf(station) ? (
                      <Badge variant="secondary">
                        {t('viaFallback', { station: fallbackOf(station)!.name })}
                      </Badge>
                    ) : (
                      <Badge variant="destructive" title={t('noOutputHint')}>
                        {t('noOutput')}
                      </Badge>
                    )
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell data-testid="station-fallback">
                  {stations.find((s) => s.id === station.fallbackStationId)?.name ?? '—'}
                </TableCell>
                <TableCell className="tabular-nums">{station.sortOrder}</TableCell>
                <TableCell>
                  <Switch
                    checked={station.isActive}
                    disabled={!canEdit || toggle.pending}
                    onCheckedChange={(checked) => void toggle.run(station.id, checked)}
                    aria-label={`${tc('active')}: ${station.name}`}
                  />
                </TableCell>
                {canEdit ? (
                  <TableCell className="text-right whitespace-nowrap">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={tc('edit')}
                      title={tc('edit')}
                      onClick={() =>
                        setDraft({
                          id: station.id,
                          name: station.name,
                          alertAfterMinutes:
                            station.alertAfterMinutes === null
                              ? ''
                              : String(station.alertAfterMinutes),
                          language: toOption(station.language),
                          printerId: toOption(station.printerId),
                          fallbackStationId: toOption(station.fallbackStationId),
                          sortOrder: station.sortOrder,
                          isActive: station.isActive,
                        })
                      }
                    >
                      <PencilIcon />
                    </Button>
                    <ConfirmButton
                      variant="ghost"
                      size="icon"
                      aria-label={tc('delete')}
                      disabled={remove.pending}
                      title={tc('confirmDeleteTitle')}
                      description={tc('confirmDeleteText')}
                      confirmLabel={tc('delete')}
                      cancelLabel={tc('cancel')}
                      onConfirm={() => remove.run(station.id)}
                    >
                      <Trash2Icon />
                    </ConfirmButton>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={!!draft} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent closeLabel={tc('close')}>
          {draft ? (
            <StationForm
              initial={draft}
              printers={printers}
              stations={stations}
              defaults={defaults}
              onCancel={() => setDraft(null)}
              onSaved={() => setDraft(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/** Create/edit form; mounted per dialog opening so its field errors start empty. */
function StationForm({
  initial,
  printers,
  stations,
  defaults,
  onCancel,
  onSaved,
}: {
  initial: StationDraft;
  printers: people.PrinterDto[];
  stations: people.KitchenStationDto[];
  defaults: StationDefaults;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('stations');
  const tc = useTranslations('common');
  const tl = useTranslations('languages');
  const [form, setForm] = useState(initial);
  const save = useServerAction(
    (draft: StationDraft) => {
      const minutes = draft.alertAfterMinutes.trim();
      const body = {
        name: draft.name,
        alertAfterMinutes: minutes === '' ? null : Number(minutes),
        language: fromOption(draft.language),
        printerId: fromOption(draft.printerId),
        fallbackStationId: fromOption(draft.fallbackStationId),
        sortOrder: draft.sortOrder,
        isActive: draft.isActive,
      };
      return draft.id
        ? actions.updateKitchenStation(draft.id, body)
        : actions.createKitchenStation(body);
    },
    { onSuccess: onSaved },
  );
  const errors = save.fieldErrors;

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save.run(form);
      }}
    >
      <DialogHeader>
        <DialogTitle>{form.id ? t('edit') : t('new')}</DialogTitle>
      </DialogHeader>
      <Field label={tc('name')} htmlFor="station-name" error={errors.name}>
        <Input
          id="station-name"
          required
          autoFocus
          maxLength={100}
          value={form.name}
          aria-invalid={!!errors.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={t('alertAfterLabel')}
          htmlFor="station-alert"
          hint={t('alertAfterHint', { minutes: defaults.alertAfterMinutes })}
          error={errors.alertAfterMinutes}
        >
          <Input
            id="station-alert"
            type="number"
            inputMode="numeric"
            min={1}
            max={240}
            placeholder={String(defaults.alertAfterMinutes)}
            value={form.alertAfterMinutes}
            aria-invalid={!!errors.alertAfterMinutes}
            onChange={(e) => setForm({ ...form, alertAfterMinutes: e.target.value })}
          />
        </Field>
        <Field
          label={t('language')}
          htmlFor="station-language"
          hint={t('languageHint')}
          error={errors.language}
        >
          <Select
            value={form.language}
            onValueChange={(language) => setForm({ ...form, language })}
          >
            <SelectTrigger id="station-language">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>
                {t('standard', { value: tl(defaults.language) })}
              </SelectItem>
              {CONTENT_LANGUAGES.map((code) => (
                <SelectItem key={code} value={code}>
                  {tl(code)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <Field
        label={t('printer')}
        htmlFor="station-printer"
        hint={t('printerHint')}
        error={errors.printerId}
      >
        <Select
          value={form.printerId}
          onValueChange={(printerId) => setForm({ ...form, printerId })}
        >
          <SelectTrigger id="station-printer">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{tc('none')}</SelectItem>
            {selectable(printers, fromOption(initial.printerId)).map((printer) => (
              <SelectItem key={printer.id} value={printer.id}>
                {printer.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field
        label={t('fallbackLabel')}
        htmlFor="station-fallback"
        hint={t('fallbackHint')}
        error={errors.fallbackStationId}
      >
        <Select
          value={form.fallbackStationId}
          onValueChange={(fallbackStationId) => setForm({ ...form, fallbackStationId })}
        >
          <SelectTrigger id="station-fallback">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t('fallbackNone')}</SelectItem>
            {selectable(stations, fromOption(initial.fallbackStationId))
              .filter((station) => station.id !== form.id)
              .map((station) => (
                <SelectItem key={station.id} value={station.id}>
                  {station.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </Field>
      <div className="grid items-end gap-4 sm:grid-cols-2">
        <Field label={tc('sortOrder')} htmlFor="station-sort" error={errors.sortOrder}>
          <Input
            id="station-sort"
            type="number"
            inputMode="numeric"
            min={0}
            value={form.sortOrder}
            onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })}
          />
        </Field>
        <div className="flex min-h-11 items-center gap-3">
          <Switch
            id="station-active"
            checked={form.isActive}
            onCheckedChange={(isActive) => setForm({ ...form, isActive })}
          />
          <Label htmlFor="station-active">{tc('active')}</Label>
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {tc('cancel')}
        </Button>
        <Button type="submit" disabled={save.pending}>
          {save.pending ? tc('saving') : tc('save')}
        </Button>
      </DialogFooter>
    </form>
  );
}
