'use client';

import type { people } from '@pos/api';
import { PRINTER_KINDS, PRINTER_PROTOCOLS } from '@pos/core';
import { Alert } from '@pos/ui/alert';
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
import { InfoIcon, PencilIcon, PlusIcon, PrinterIcon, Trash2Icon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useServerAction } from '@/components/backoffice/use-server-action';
import * as actions from './actions';

const PAPER_WIDTHS = [80, 58] as const;

type PrinterDraft = {
  id?: string;
  name: string;
  kind: string;
  protocol: string;
  host: string;
  port: number;
  paperWidthMm: number;
  hasCashDrawer: boolean;
  isActive: boolean;
};

/** Network printers for receipts and kitchen tickets (RF-F17). */
export function PrintersManager({
  printers,
  canEdit,
}: {
  printers: people.PrinterDto[];
  canEdit: boolean;
}) {
  const t = useTranslations('printers');
  const tc = useTranslations('common');
  const [draft, setDraft] = useState<PrinterDraft | null>(null);

  const toggle = useServerAction((id: string, isActive: boolean) =>
    actions.updatePrinter(id, { isActive }),
  );
  const remove = useServerAction(actions.deletePrinter);
  const test = useServerAction(actions.testPrinter, { successMessage: t('testRequested') });
  const router = useRouter();
  // While a test page is on its way, look for the hub's answer every few seconds.
  const waiting = printers.some(
    (p) =>
      p.testRequestedAt &&
      (!p.lastTestAt || Date.parse(p.lastTestAt) < Date.parse(p.testRequestedAt)) &&
      Date.now() - Date.parse(p.testRequestedAt) < 120_000,
  );
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => router.refresh(), 3_000);
    return () => clearInterval(timer);
  }, [waiting, router]);

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
                kind: 'receipt',
                protocol: 'escpos',
                host: '',
                port: 9100,
                paperWidthMm: 80,
                hasCashDrawer: false,
                isActive: true,
              })
            }
          >
            <PlusIcon /> {t('new')}
          </Button>
        ) : null}
      </CardHeader>
      <Alert icon={false} variant="info" className="flex items-center gap-2">
        <InfoIcon className="size-4 shrink-0" aria-hidden />
        <span>{t('hubNote')}</span>
      </Alert>
      {printers.length === 0 ? (
        <EmptyState compact icon={<PrinterIcon />} title={t('empty')} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tc('name')}</TableHead>
              <TableHead>{t('kind')}</TableHead>
              <TableHead>{t('protocol')}</TableHead>
              <TableHead>{t('address')}</TableHead>
              <TableHead>{t('paperWidth')}</TableHead>
              <TableHead>{t('cashDrawer')}</TableHead>
              <TableHead>{t('state')}</TableHead>
              <TableHead>{tc('active')}</TableHead>
              {canEdit ? <TableHead className="text-right">{tc('actions')}</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {printers.map((printer) => (
              <TableRow key={printer.id}>
                <TableCell className="font-medium">{printer.name}</TableCell>
                <TableCell>
                  <Badge variant="outline">{t(`kinds.${printer.kind}`)}</Badge>
                </TableCell>
                <TableCell>{t(`protocols.${printer.protocol}`)}</TableCell>
                <TableCell className="font-mono text-xs">
                  {printer.host}:{printer.port}
                </TableCell>
                <TableCell className="tabular-nums">
                  {t('paperWidthValue', { mm: printer.paperWidthMm })}
                </TableCell>
                <TableCell>{printer.hasCashDrawer ? tc('yes') : tc('no')}</TableCell>
                <TableCell data-testid="printer-state">
                  <PrinterState printer={printer} />
                </TableCell>
                <TableCell>
                  <Switch
                    checked={printer.isActive}
                    disabled={!canEdit || toggle.pending}
                    onCheckedChange={(checked) => void toggle.run(printer.id, checked)}
                    aria-label={`${tc('active')}: ${printer.name}`}
                  />
                </TableCell>
                {canEdit ? (
                  <TableCell className="text-right whitespace-nowrap">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('test')}
                      title={t('test')}
                      disabled={test.pending || !printer.isActive}
                      onClick={() => void test.run(printer.id)}
                    >
                      <PrinterIcon />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={tc('edit')}
                      title={tc('edit')}
                      onClick={() =>
                        setDraft({
                          id: printer.id,
                          name: printer.name,
                          kind: printer.kind,
                          protocol: printer.protocol,
                          host: printer.host,
                          port: printer.port,
                          paperWidthMm: printer.paperWidthMm,
                          hasCashDrawer: printer.hasCashDrawer,
                          isActive: printer.isActive,
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
                      onConfirm={() => remove.run(printer.id)}
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
            <PrinterForm
              initial={draft}
              onCancel={() => setDraft(null)}
              onSaved={() => setDraft(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/**
 * What the location hub last reported (DEC-032): the test page asked for and its result, the
 * last error, or that it prints.
 */
function PrinterState({ printer }: { printer: people.PrinterDto }) {
  const t = useTranslations('printers');
  const format = useFormatter();
  const when = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: 'short', timeStyle: 'short' });
  const testPending =
    printer.testRequestedAt &&
    (!printer.lastTestAt || Date.parse(printer.lastTestAt) < Date.parse(printer.testRequestedAt));
  if (testPending) return <Badge variant="secondary">{t('testPending')}</Badge>;
  const lastOk = printer.lastOkAt ? Date.parse(printer.lastOkAt) : 0;
  const lastError = printer.lastErrorAt ? Date.parse(printer.lastErrorAt) : 0;
  if (lastError > lastOk && printer.lastError) {
    return (
      <span className="grid gap-0.5">
        <Badge variant="destructive">{t('stateError')}</Badge>
        <span className="text-xs text-muted-foreground">{printer.lastError}</span>
      </span>
    );
  }
  if (printer.lastTestAt) {
    return (
      <Badge variant={printer.lastTestOk ? 'success' : 'destructive'}>
        {printer.lastTestOk
          ? t('testOk', { when: when(printer.lastTestAt) })
          : t('testFailed', { when: when(printer.lastTestAt) })}
      </Badge>
    );
  }
  if (printer.lastOkAt) return <Badge variant="success">{t('stateOk')}</Badge>;
  return <span className="text-sm text-muted-foreground">{t('stateUnknown')}</span>;
}

/** Create/edit form; mounted per dialog opening so its field errors start empty. */
function PrinterForm({
  initial,
  onCancel,
  onSaved,
}: {
  initial: PrinterDraft;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('printers');
  const tc = useTranslations('common');
  const [form, setForm] = useState(initial);
  const save = useServerAction(
    ({ id, ...body }: PrinterDraft) =>
      id ? actions.updatePrinter(id, body) : actions.createPrinter(body),
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
      <Field label={tc('name')} htmlFor="printer-name" error={errors.name}>
        <Input
          id="printer-name"
          required
          autoFocus
          maxLength={100}
          value={form.name}
          aria-invalid={!!errors.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('kind')} htmlFor="printer-kind" error={errors.kind}>
          <Select value={form.kind} onValueChange={(kind) => setForm({ ...form, kind })}>
            <SelectTrigger id="printer-kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRINTER_KINDS.map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {t(`kinds.${kind}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label={t('protocol')} htmlFor="printer-protocol" error={errors.protocol}>
          <Select
            value={form.protocol}
            onValueChange={(protocol) => setForm({ ...form, protocol })}
          >
            <SelectTrigger id="printer-protocol">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRINTER_PROTOCOLS.map((protocol) => (
                <SelectItem key={protocol} value={protocol}>
                  {t(`protocols.${protocol}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
        <Field label={t('host')} htmlFor="printer-host" hint={t('hostHint')} error={errors.host}>
          <Input
            id="printer-host"
            required
            maxLength={255}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
            value={form.host}
            aria-invalid={!!errors.host}
            onChange={(e) => setForm({ ...form, host: e.target.value })}
          />
        </Field>
        <Field label={t('port')} htmlFor="printer-port" error={errors.port}>
          <Input
            id="printer-port"
            type="number"
            inputMode="numeric"
            required
            min={1}
            max={65535}
            value={form.port}
            aria-invalid={!!errors.port}
            onChange={(e) => setForm({ ...form, port: Number(e.target.value) })}
          />
        </Field>
      </div>
      <div className="grid items-end gap-4 sm:grid-cols-2">
        <Field label={t('paperWidth')} htmlFor="printer-paper" error={errors.paperWidthMm}>
          <Select
            value={String(form.paperWidthMm)}
            onValueChange={(value) => setForm({ ...form, paperWidthMm: Number(value) })}
          >
            <SelectTrigger id="printer-paper">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAPER_WIDTHS.map((mm) => (
                <SelectItem key={mm} value={String(mm)}>
                  {t('paperWidthValue', { mm })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <div className="flex min-h-11 items-center gap-3">
          <Switch
            id="printer-drawer"
            checked={form.hasCashDrawer}
            onCheckedChange={(hasCashDrawer) => setForm({ ...form, hasCashDrawer })}
          />
          <Label htmlFor="printer-drawer">{t('cashDrawerLabel')}</Label>
        </div>
      </div>
      <div className="flex min-h-11 items-center gap-3">
        <Switch
          id="printer-active"
          checked={form.isActive}
          onCheckedChange={(isActive) => setForm({ ...form, isActive })}
        />
        <Label htmlFor="printer-active">{tc('active')}</Label>
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
