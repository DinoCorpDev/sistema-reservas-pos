'use client';

import { Badge } from '@pos/ui/badge';
import { Button } from '@pos/ui/button';
import { Card } from '@pos/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@pos/ui/dialog';
import { Textarea } from '@pos/ui/input';
import { Field, Label } from '@pos/ui/label';
import { Switch } from '@pos/ui/switch';
import { cn } from '@pos/ui/utils';
import { CheckIcon, CircleCheckIcon } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type FormEvent, type ReactNode, useState, useTransition } from 'react';
import { formatDateTime, shortId } from '@/components/backoffice/admin/format';
import { useServerAction } from '@/components/backoffice/use-server-action';
import { resolveSyncConflict } from './actions';
import type { ConflictHint, ConflictRow } from './rows';

interface NamedRef {
  id: string;
  name: string;
}

/** Translated labels shared by the cards and the resolve dialog. */
function useConflictLabels(users: NamedRef[], terminals: NamedRef[]) {
  const t = useTranslations('syncConflicts');
  const userName = new Map(users.map((user) => [user.id, user.name]));
  const terminalName = new Map(terminals.map((terminal) => [terminal.id, terminal.name]));
  const translated = (key: string, fallback: string) => (t.has(key) ? t(key) : fallback);
  return {
    person: (id: string | null) => (id ? (userName.get(id) ?? shortId(id)) : t('unknownPerson')),
    terminal: (id: string) => terminalName.get(id) ?? shortId(id),
    operation: (operation: string) => translated(`operations.${operation}`, operation),
    code: (code: string) => ({
      label: translated(`codes.${code}.label`, code),
      what: translated(`codes.${code}.what`, t('unknownCode.what')),
      todo: translated(`codes.${code}.todo`, t('unknownCode.todo')),
    }),
    hint: (hint: ConflictHint) =>
      'amount' in hint
        ? t(`hints.${hint.kind}`, {
            amount: hint.amount,
            method: translated(`methods.${hint.method}`, hint.method),
          })
        : t(`hints.${hint.kind}`, { number: hint.number }),
  };
}
type ConflictLabels = ReturnType<typeof useConflictLabels>;

/**
 * The manager's list of synchronization conflicts (RNF-04): what happened, what to do, and a
 * required note to mark each one as resolved. Resolved ones are shown greyed on request.
 */
export function ConflictList({
  rows,
  includeResolved,
  users,
  terminals,
}: {
  rows: ConflictRow[];
  includeResolved: boolean;
  users: NamedRef[];
  terminals: NamedRef[];
}) {
  const t = useTranslations('syncConflicts');
  const tc = useTranslations('common');
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [resolving, setResolving] = useState<ConflictRow | null>(null);
  const labels = useConflictLabels(users, terminals);
  const openCount = rows.filter((row) => !row.resolvedAt).length;

  const toggleResolved = (checked: boolean) =>
    startTransition(() => router.replace(checked ? `${pathname}?resolved=1` : pathname));

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {openCount > 0 ? t('openCount', { count: openCount }) : null}
        </p>
        <div className="flex min-h-11 items-center gap-3">
          <Switch
            id="show-resolved"
            checked={includeResolved}
            disabled={pending}
            onCheckedChange={toggleResolved}
          />
          <Label htmlFor="show-resolved">{t('showResolved')}</Label>
        </div>
      </div>

      <div
        aria-busy={pending}
        className={cn('grid gap-4', pending && 'opacity-60 transition-opacity')}
      >
        {openCount === 0 ? (
          <Card className="flex-row items-center gap-3">
            <CircleCheckIcon className="size-5 shrink-0 text-success" aria-hidden />
            <p>{t('empty')}</p>
          </Card>
        ) : null}
        {rows.length > 0 ? (
          <ul className="grid gap-4">
            {rows.map((row) => (
              <ConflictCard
                key={row.id}
                row={row}
                labels={labels}
                onResolve={() => setResolving(row)}
              />
            ))}
          </ul>
        ) : null}
      </div>

      <Dialog
        open={resolving !== null}
        onOpenChange={(open) => {
          if (!open) setResolving(null);
        }}
      >
        <DialogContent closeLabel={tc('close')}>
          {resolving ? (
            <ResolveForm
              key={resolving.id}
              row={resolving}
              labels={labels}
              onCancel={() => setResolving(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 content-start gap-0.5">
      <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function ConflictCard({
  row,
  labels,
  onResolve,
}: {
  row: ConflictRow;
  labels: ConflictLabels;
  onResolve: () => void;
}) {
  const t = useTranslations('syncConflicts');
  const resolved = row.resolvedAt !== null;

  return (
    <li>
      <Card className={cn(resolved && 'bg-muted/40 text-muted-foreground shadow-none')}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <dl className="grid min-w-0 flex-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
            <Meta label={t('deviceTime')}>
              <span className="tabular-nums">
                {formatDateTime(row.deviceAt, { seconds: true })}
              </span>
              <span className="block text-xs text-muted-foreground tabular-nums">
                {t('receivedAt', { time: formatDateTime(row.receivedAt) })}
              </span>
            </Meta>
            <Meta label={t('operation')}>
              <span className="font-medium">{labels.operation(row.operation)}</span>
            </Meta>
            <Meta label={t('order')}>
              {row.orderId ? (
                <span className="font-mono" title={row.orderId}>
                  {shortId(row.orderId)}
                </span>
              ) : (
                t('noOrder')
              )}
              {row.hint ? (
                <span className="block text-xs text-muted-foreground">{labels.hint(row.hint)}</span>
              ) : null}
            </Meta>
            <Meta label={t('person')}>
              {labels.person(row.userId)}
              <span className="block text-xs text-muted-foreground">
                {t('terminal', { name: labels.terminal(row.terminalId) })}
              </span>
            </Meta>
          </dl>
          {resolved ? (
            <Badge variant="outline" className="text-muted-foreground">
              <CircleCheckIcon className="size-3.5" aria-hidden /> {t('resolvedBadge')}
            </Badge>
          ) : (
            <Button onClick={onResolve}>
              <CheckIcon /> {t('resolve')}
            </Button>
          )}
        </div>

        {row.codes.length > 0 ? (
          <ul className="grid gap-2">
            {row.codes.map((code) => {
              const text = labels.code(code);
              return (
                <li key={code} className="grid gap-1.5 rounded-lg border p-3">
                  <Badge variant={resolved ? 'outline' : 'warning'}>{text.label}</Badge>
                  <p>{text.what}</p>
                  <p className="text-sm">
                    <span className="font-medium">{t('whatToDo')}:</span> {text.todo}
                  </p>
                </li>
              );
            })}
          </ul>
        ) : null}

        {row.resolvedAt ? (
          <p className="text-sm">
            {t('resolvedBy', {
              date: formatDateTime(row.resolvedAt),
              person: labels.person(row.resolvedByUserId),
            })}
          </p>
        ) : null}
      </Card>
    </li>
  );
}

/** A note is required: it goes to the audit log as the reason of the resolution. */
function ResolveForm({
  row,
  labels,
  onCancel,
}: {
  row: ConflictRow;
  labels: ConflictLabels;
  onCancel: () => void;
}) {
  const t = useTranslations('syncConflicts');
  const tc = useTranslations('common');
  const [note, setNote] = useState('');
  const resolve = useServerAction(resolveSyncConflict, {
    successMessage: t('resolved'),
    onSuccess: onCancel,
  });
  const trimmed = note.trim();
  const invalid = Boolean(resolve.fieldErrors.note);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (trimmed) void resolve.run(row.id, trimmed);
  };

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>{t('resolveTitle')}</DialogTitle>
        <DialogDescription>{t('resolveText')}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-1 text-sm">
        <p>
          <span className="font-medium">{labels.operation(row.operation)}</span> ·{' '}
          <span className="tabular-nums">{formatDateTime(row.deviceAt)}</span>
        </p>
        <p className="text-muted-foreground">
          {row.codes.map((code) => labels.code(code).label).join(', ')}
        </p>
      </div>
      <Field
        label={t('note')}
        htmlFor="sync-conflict-note"
        error={invalid ? t('noteRequired') : undefined}
      >
        <Textarea
          id="sync-conflict-note"
          required
          maxLength={500}
          placeholder={t('notePlaceholder')}
          aria-invalid={invalid || undefined}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {tc('cancel')}
        </Button>
        <Button type="submit" disabled={resolve.pending || trimmed === ''}>
          <CheckIcon /> {resolve.pending ? tc('saving') : t('resolve')}
        </Button>
      </DialogFooter>
    </form>
  );
}
