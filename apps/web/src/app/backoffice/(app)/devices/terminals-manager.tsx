'use client';

import type { people } from '@pos/api';
import { CREATABLE_TERMINAL_TYPES } from '@pos/core';
import { ActionGroup } from '@pos/ui/action-group';
import { Badge } from '@pos/ui/badge';
import { Button } from '@pos/ui/button';
import { Card, CardDescription, CardHeader, CardTitle, IconTile } from '@pos/ui/card';
import { ConfirmButton } from '@pos/ui/confirm';
import { EmptyState } from '@pos/ui/empty-state';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@pos/ui/dialog';
import { Input } from '@pos/ui/input';
import { Field } from '@pos/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@pos/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@pos/ui/table';
import {
  ChefHatIcon,
  LinkIcon,
  PrinterIcon,
  type LucideIcon,
  MonitorIcon,
  MonitorSmartphoneIcon,
  PencilIcon,
  PlusIcon,
  PowerIcon,
  PowerOffIcon,
  RouterIcon,
  SmartphoneIcon,
  TabletSmartphoneIcon,
  UnlinkIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useDateTime } from '@/components/backoffice/people/use-date-time';
import { useServerAction } from '@/components/backoffice/use-server-action';
import type { ActionResult } from '@/server/action';
import * as actions from './actions';
import { fromOption, NONE, selectable, toOption } from './options';
import { type Pairing, PairingDialog } from './pairing-dialog';

/** One icon per kind of device (DEC-053). */
export const TERMINAL_ICONS: Record<string, LucideIcon> = {
  pos: MonitorIcon,
  handheld: TabletSmartphoneIcon,
  kds: ChefHatIcon,
  hub: RouterIcon,
  phone: SmartphoneIcon,
};

type TerminalDraft = {
  id?: string;
  name: string;
  type: string;
  orderNumberPrefix: string;
  kitchenStationId: string;
  receiptPrinterId: string;
};

/** First free `K1`, `K2`… so a new terminal starts with a valid, unique prefix (RN-16). */
function suggestPrefix(terminals: people.TerminalDto[]) {
  const taken = new Set(terminals.map((terminal) => terminal.orderNumberPrefix));
  for (let n = 1; n < 1000; n += 1) if (!taken.has(`K${n}`)) return `K${n}`;
  return '';
}

/** POS terminals, handhelds and KDS screens: setup, pairing and (de)activation (RF-A03, RF-A12). */
export function TerminalsManager({
  terminals,
  stations,
  printers,
  canEdit,
}: {
  terminals: people.TerminalDto[];
  stations: people.KitchenStationDto[];
  printers: people.PrinterDto[];
  canEdit: boolean;
}) {
  const t = useTranslations('terminals');
  const tc = useTranslations('common');
  const formatDate = useDateTime();
  const now = useNow({ updateInterval: 30_000 });
  const format = useFormatter();
  const router = useRouter();
  const [draft, setDraft] = useState<TerminalDraft | null>(null);
  const [pairing, setPairing] = useState<Pairing | null>(null);

  const pair = useServerAction(
    async (terminal: { id: string; name: string }): Promise<ActionResult<Pairing>> => {
      const result = await actions.issuePairingCode(terminal.id);
      if (!result.ok) return result;
      return {
        ok: true,
        data: { ...result.data, kind: 'device', terminalId: terminal.id, name: terminal.name },
      };
    },
    { successMessage: false, onSuccess: setPairing },
  );
  // A paired device is not taken over by another one (DEC-041): it is unpaired first.
  const unpair = useServerAction((id: string) => actions.unpairTerminal(id), {
    successMessage: t('unpaired'),
  });
  const deactivate = useServerAction(
    (id: string) => actions.updateTerminal(id, { isActive: false }),
    { successMessage: t('deactivated') },
  );
  // Activating only activates: the pairing code comes when the manager asks for it (link button).
  const activate = useServerAction((id: string) => actions.updateTerminal(id, { isActive: true }), {
    successMessage: t('activated'),
  });

  const stationName = (id: string | null) => stations.find((s) => s.id === id)?.name ?? '—';
  const printerName = (id: string | null) => printers.find((p) => p.id === id)?.name ?? '—';

  const pairingState = (terminal: people.TerminalDto) => {
    if (terminal.isPaired) {
      return (
        <Badge variant="success" dot title={formatDate(terminal.pairedAt) ?? undefined}>
          {t('paired')}
        </Badge>
      );
    }
    const pending =
      terminal.pairingExpiresAt && new Date(terminal.pairingExpiresAt).getTime() > now.getTime();
    return pending ? (
      <Badge variant="warning" dot>
        {t('codePending', { time: formatDate(terminal.pairingExpiresAt, 'time') ?? '' })}
      </Badge>
    ) : (
      <Badge variant="secondary" dot>
        {t('notPaired')}
      </Badge>
    );
  };

  return (
    <Card>
      <CardHeader
        icon={<MonitorSmartphoneIcon />}
        action={
          canEdit ? (
            <Button
              onClick={() =>
                setDraft({
                  name: '',
                  type: 'pos',
                  orderNumberPrefix: suggestPrefix(terminals),
                  kitchenStationId: NONE,
                  receiptPrinterId: NONE,
                })
              }
            >
              <PlusIcon /> {t('new')}
            </Button>
          ) : null
        }
      >
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('hint')}</CardDescription>
      </CardHeader>
      {terminals.length === 0 ? (
        <EmptyState
          icon={<MonitorSmartphoneIcon />}
          title={t('empty')}
          description={t('emptyHint')}
          compact
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('device')}</TableHead>
              <TableHead>{t('prefix')}</TableHead>
              <TableHead>{t('assignment')}</TableHead>
              <TableHead>{t('pairing')}</TableHead>
              <TableHead>{t('lastSeen')}</TableHead>
              {canEdit ? <TableHead className="text-right">{tc('actions')}</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {terminals.map((terminal) => {
              const Icon = TERMINAL_ICONS[terminal.type] ?? MonitorIcon;
              return (
                <TableRow
                  key={terminal.id}
                  className={terminal.isActive ? undefined : 'opacity-60'}
                >
                  <TableCell>
                    <div className="flex min-w-44 items-center gap-3">
                      <IconTile tone={terminal.isActive ? 'brand' : 'muted'}>
                        <Icon />
                      </IconTile>
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 font-medium">
                          {terminal.name}
                          {terminal.isActive ? null : (
                            <Badge variant="secondary">{tc('inactive')}</Badge>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {t(`types.${terminal.type}`)}
                          {terminal.appVersion ? ` · v${terminal.appVersion}` : ''}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="rounded-md bg-muted px-2 py-1 font-mono text-xs">
                      {terminal.orderNumberPrefix}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm">
                    {/* Where its orders go and where it prints, one line each. */}
                    <div className="grid min-w-36 gap-1">
                      {terminal.kitchenStationId || terminal.type === 'kds' ? (
                        <span className="flex items-center gap-1.5" title={t('station')}>
                          <ChefHatIcon aria-hidden className="size-3.5 text-muted-foreground" />
                          <span className="sr-only">{t('station')}: </span>
                          {terminal.type === 'kds' && !terminal.kitchenStationId
                            ? t('stationAtSignIn')
                            : stationName(terminal.kitchenStationId)}
                        </span>
                      ) : null}
                      {terminal.receiptPrinterId ? (
                        <span className="flex items-center gap-1.5" title={t('receiptPrinter')}>
                          <PrinterIcon aria-hidden className="size-3.5 text-muted-foreground" />
                          <span className="sr-only">{t('receiptPrinter')}: </span>
                          {printerName(terminal.receiptPrinterId)}
                        </span>
                      ) : null}
                      {!terminal.kitchenStationId &&
                      terminal.type !== 'kds' &&
                      !terminal.receiptPrinterId ? (
                        <span className="text-muted-foreground">—</span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>{pairingState(terminal)}</TableCell>
                  <TableCell
                    suppressHydrationWarning
                    className="text-sm whitespace-nowrap text-muted-foreground"
                    title={formatDate(terminal.lastSeenAt) ?? undefined}
                  >
                    {terminal.lastSeenAt
                      ? format.relativeTime(new Date(terminal.lastSeenAt), now)
                      : t('never')}
                  </TableCell>
                  {canEdit ? (
                    <TableCell className="text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-2">
                        {/* Pairing is the next step of an unpaired device; a hub can always get a new code. */}
                        {terminal.isActive && (!terminal.isPaired || terminal.type === 'hub') ? (
                          <Button
                            variant="outline"
                            className="text-brand-strong"
                            aria-label={t('pair')}
                            disabled={pair.pending}
                            onClick={() => void pair.run(terminal)}
                          >
                            <LinkIcon /> {t('pairShort')}
                          </Button>
                        ) : null}
                        <ActionGroup label={tc('actions')}>
                          {terminal.isActive && terminal.isPaired && terminal.type !== 'hub' ? (
                            <ConfirmButton
                              variant="ghost"
                              size="icon"
                              aria-label={t('unpair')}
                              disabled={unpair.pending}
                              title={t('unpairTitle', { name: terminal.name })}
                              description={t('unpairText', { name: terminal.name })}
                              confirmLabel={t('unpair')}
                              cancelLabel={tc('cancel')}
                              onConfirm={() => unpair.run(terminal.id)}
                            >
                              <UnlinkIcon />
                            </ConfirmButton>
                          ) : null}
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={tc('edit')}
                            title={tc('edit')}
                            onClick={() =>
                              setDraft({
                                id: terminal.id,
                                name: terminal.name,
                                type: terminal.type,
                                orderNumberPrefix: terminal.orderNumberPrefix,
                                kitchenStationId: toOption(terminal.kitchenStationId),
                                receiptPrinterId: toOption(terminal.receiptPrinterId),
                              })
                            }
                          >
                            <PencilIcon />
                          </Button>
                          {terminal.isActive ? (
                            <ConfirmButton
                              variant="ghost"
                              size="icon"
                              className="hover:bg-destructive/10 hover:text-destructive"
                              aria-label={t('deactivate')}
                              disabled={deactivate.pending}
                              title={t('deactivateTitle', { name: terminal.name })}
                              description={t('deactivateText')}
                              confirmLabel={tc('deactivate')}
                              cancelLabel={tc('cancel')}
                              onConfirm={() => deactivate.run(terminal.id)}
                            >
                              <PowerOffIcon />
                            </ConfirmButton>
                          ) : (
                            <ConfirmButton
                              variant="ghost"
                              size="icon"
                              aria-label={t('activate')}
                              disabled={activate.pending}
                              title={t('activateTitle', { name: terminal.name })}
                              description={t('activateText')}
                              confirmLabel={tc('activate')}
                              cancelLabel={tc('cancel')}
                              onConfirm={() => activate.run(terminal.id)}
                            >
                              <PowerIcon />
                            </ConfirmButton>
                          )}
                        </ActionGroup>
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <Dialog open={!!draft} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent closeLabel={tc('close')}>
          {draft ? (
            <TerminalForm
              initial={draft}
              stations={stations}
              printers={printers}
              onCancel={() => setDraft(null)}
              onSaved={() => setDraft(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <PairingDialog
        pairing={pairing}
        renewing={pair.pending}
        onRenew={() =>
          pairing?.kind === 'device' &&
          void pair.run({ id: pairing.terminalId, name: pairing.name })
        }
        onClose={() => {
          setPairing(null);
          // The device may have paired meanwhile.
          router.refresh();
        }}
      />
    </Card>
  );
}

/** Create/edit form; mounted per dialog opening so its field errors start empty. */
function TerminalForm({
  initial,
  stations,
  printers,
  onCancel,
  onSaved,
}: {
  initial: TerminalDraft;
  stations: people.KitchenStationDto[];
  printers: people.PrinterDto[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('terminals');
  const tc = useTranslations('common');
  const [form, setForm] = useState(initial);
  const save = useServerAction(
    (draft: TerminalDraft) => {
      const body = {
        name: draft.name,
        type: draft.type,
        orderNumberPrefix: draft.orderNumberPrefix,
        kitchenStationId: fromOption(draft.kitchenStationId),
        receiptPrinterId: fromOption(draft.receiptPrinterId),
      };
      return draft.id ? actions.updateTerminal(draft.id, body) : actions.createTerminal(body);
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
      <Field label={tc('name')} htmlFor="terminal-name" error={errors.name}>
        <Input
          id="terminal-name"
          required
          autoFocus
          maxLength={100}
          value={form.name}
          aria-invalid={!!errors.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('type')} htmlFor="terminal-type">
          <Select value={form.type} onValueChange={(type) => setForm({ ...form, type })}>
            <SelectTrigger id="terminal-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CREATABLE_TERMINAL_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {t(`types.${type}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field
          label={t('prefixLabel')}
          htmlFor="terminal-prefix"
          hint={t('prefixHint')}
          error={errors.orderNumberPrefix}
        >
          <Input
            id="terminal-prefix"
            required
            maxLength={4}
            pattern="[A-Z0-9]{1,4}"
            autoComplete="off"
            className="font-mono uppercase"
            value={form.orderNumberPrefix}
            aria-invalid={!!errors.orderNumberPrefix}
            onChange={(e) =>
              setForm({
                ...form,
                orderNumberPrefix: e.target.value
                  .toUpperCase()
                  .replace(/[^A-Z0-9]/g, '')
                  .slice(0, 4),
              })
            }
          />
        </Field>
      </div>
      <Field
        label={t('station')}
        htmlFor="terminal-station"
        hint={t('stationHint')}
        error={errors.kitchenStationId}
      >
        <Select
          value={form.kitchenStationId}
          onValueChange={(kitchenStationId) => setForm({ ...form, kitchenStationId })}
        >
          <SelectTrigger id="terminal-station">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {/* A kitchen display without a fixed station asks for one at sign-in (DEC-042). */}
            <SelectItem value={NONE}>
              {form.type === 'kds' ? t('stationAtSignIn') : tc('none')}
            </SelectItem>
            {selectable(stations, fromOption(initial.kitchenStationId)).map((station) => (
              <SelectItem key={station.id} value={station.id}>
                {station.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field
        label={t('receiptPrinter')}
        htmlFor="terminal-printer"
        hint={t('receiptPrinterHint')}
        error={errors.receiptPrinterId}
      >
        <Select
          value={form.receiptPrinterId}
          onValueChange={(receiptPrinterId) => setForm({ ...form, receiptPrinterId })}
        >
          <SelectTrigger id="terminal-printer">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{tc('none')}</SelectItem>
            {selectable(printers, fromOption(initial.receiptPrinterId)).map((printer) => (
              <SelectItem key={printer.id} value={printer.id}>
                {printer.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
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
