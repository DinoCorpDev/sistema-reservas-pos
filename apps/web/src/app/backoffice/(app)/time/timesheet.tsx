'use client';

import type { people } from '@pos/api';
import { formatWorked } from '@pos/core';
import { ActionGroup } from '@pos/ui/action-group';
import { Avatar } from '@pos/ui/avatar';
import { Badge } from '@pos/ui/badge';
import { Button } from '@pos/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@pos/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@pos/ui/dialog';
import { EmptyState } from '@pos/ui/empty-state';
import { Input } from '@pos/ui/input';
import { Field } from '@pos/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@pos/ui/table';
import { ClockIcon, PencilIcon, TimerOffIcon, UsersIcon } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useServerAction } from '@/components/backoffice/use-server-action';
import * as actions from './actions';

type Sheet = people.TimesheetDto;
type Entry = people.TimeEntryDto;

const STATUS_BADGE = {
  open: 'info',
  closed: 'success',
  missing_out: 'warning',
  missing_in: 'warning',
} as const;

// ── Wall clock of the location ↔ instants, for the `datetime-local` inputs ──

function wallParts(instant: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instant));
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: part('year'),
    month: part('month'),
    day: part('day'),
    hour: part('hour'),
    minute: part('minute'),
  };
}

const pad = (value: number) => String(value).padStart(2, '0');

/** "2026-11-23T09:02" in the location's time zone, for a `datetime-local` input. */
function toInput(iso: string | null, timeZone: string): string {
  if (!iso) return '';
  const p = wallParts(Date.parse(iso), timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** The instant whose wall clock in `timeZone` reads `value` (DST-safe to the minute). */
function fromInput(value: string, timeZone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number) as [number, number, number, number, number, number];
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  let instant = wall;
  for (let i = 0; i < 2; i += 1) {
    const p = wallParts(instant, timeZone);
    const seen = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    instant += wall - seen;
  }
  return new Date(instant).toISOString();
}

interface Draft {
  entry: Entry;
  clockIn: string;
  clockOut: string;
  note: string;
}

/**
 * The timesheet of the period (DEC-054): hours per person, then every entry with its status. An
 * entry without exit, without entry or simply wrong is corrected here, with the reason.
 */
export function Timesheet({ sheet }: { sheet: Sheet }) {
  const t = useTranslations('time');
  const format = useFormatter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [invalid, setInvalid] = useState(false);
  const save = useServerAction(
    (id: string, body: { clockInAt: string; clockOutAt: string | null; note: string }) =>
      actions.correctTimeEntry(id, body),
    { successMessage: t('correct.saved'), onSuccess: () => setDraft(null) },
  );

  const time = (iso: string | null) =>
    iso ? format.dateTime(new Date(iso), { timeZone: sheet.timezone, timeStyle: 'short' }) : '—';
  const day = (date: string) =>
    format.dateTime(new Date(`${date}T12:00:00Z`), {
      timeZone: 'UTC',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });

  if (sheet.entries.length === 0) {
    return <EmptyState icon={<ClockIcon />} title={t('empty')} description={t('emptyHint')} />;
  }

  const open = (entry: Entry) => {
    setInvalid(false);
    setDraft({
      entry,
      clockIn: toInput(entry.clockInAt ?? entry.clockOutAt, sheet.timezone),
      clockOut: toInput(entry.clockOutAt, sheet.timezone),
      note: '',
    });
  };

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader icon={<UsersIcon />}>
          <CardTitle>{t('people.title')}</CardTitle>
          <CardDescription>{t('people.hint')}</CardDescription>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('columns.person')}</TableHead>
              <TableHead className="text-right">{t('people.entries')}</TableHead>
              <TableHead className="text-right">{t('columns.hours')}</TableHead>
              <TableHead>{t('people.incomplete')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sheet.people.map((person) => (
              <TableRow key={person.userId} data-testid={`time-person-${person.userName}`}>
                <TableCell>
                  <span className="flex items-center gap-2 font-medium">
                    <Avatar name={person.userName} colorKey={person.userId} size="sm" />
                    {person.userName}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">{person.entries}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {formatWorked(person.minutes)}
                </TableCell>
                <TableCell>
                  {person.incomplete > 0 ? (
                    <Badge variant="warning">
                      {t('people.toComplete', { count: person.incomplete })}
                    </Badge>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Card>
        <CardHeader icon={<ClockIcon />}>
          <CardTitle>{t('entries.title')}</CardTitle>
          <CardDescription>{t('entries.hint')}</CardDescription>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('columns.day')}</TableHead>
              <TableHead>{t('columns.person')}</TableHead>
              <TableHead>{t('columns.in')}</TableHead>
              <TableHead>{t('columns.out')}</TableHead>
              <TableHead className="text-right">{t('columns.hours')}</TableHead>
              <TableHead>{t('columns.status')}</TableHead>
              <TableHead className="text-right">{t('columns.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sheet.entries.map((entry) => (
              <TableRow key={entry.id} data-testid="time-entry">
                <TableCell className="whitespace-nowrap">{day(entry.businessDate)}</TableCell>
                <TableCell className="font-medium">{entry.userName}</TableCell>
                <TableCell className="tabular-nums">{time(entry.clockInAt)}</TableCell>
                <TableCell className="tabular-nums">{time(entry.clockOutAt)}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {entry.minutes === null ? '—' : formatWorked(entry.minutes)}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant={STATUS_BADGE[entry.status]} dot>
                      {t(`status.${entry.status}`)}
                    </Badge>
                    {entry.corrected ? (
                      <Badge variant="outline" title={entry.note ?? undefined}>
                        {t('corrected')}
                      </Badge>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <ActionGroup label={entry.userName}>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`${t('correct.action')}: ${entry.userName}`}
                      title={t('correct.action')}
                      onClick={() => open(entry)}
                    >
                      {entry.status === 'missing_out' ? <TimerOffIcon /> : <PencilIcon />}
                    </Button>
                  </ActionGroup>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={!!draft} onOpenChange={(value) => !value && setDraft(null)}>
        <DialogContent closeLabel={t('correct.close')}>
          {draft ? (
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                const clockInAt = fromInput(draft.clockIn, sheet.timezone);
                const clockOutAt = draft.clockOut
                  ? fromInput(draft.clockOut, sheet.timezone)
                  : null;
                if (!clockInAt || (draft.clockOut && !clockOutAt)) {
                  setInvalid(true);
                  return;
                }
                void save.run(draft.entry.id, { clockInAt, clockOutAt, note: draft.note });
              }}
            >
              <DialogHeader>
                <DialogTitle>{t('correct.title', { name: draft.entry.userName })}</DialogTitle>
                <DialogDescription>{t('correct.hint')}</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label={t('columns.in')}
                  htmlFor="time-in"
                  error={invalid ? t('correct.invalid') : save.fieldErrors.clockInAt}
                >
                  <Input
                    id="time-in"
                    type="datetime-local"
                    required
                    value={draft.clockIn}
                    onChange={(event) => setDraft({ ...draft, clockIn: event.target.value })}
                  />
                </Field>
                <Field
                  label={t('columns.out')}
                  htmlFor="time-out"
                  hint={t('correct.outHint')}
                  error={save.fieldErrors.clockOutAt ? t('correct.outError') : undefined}
                >
                  <Input
                    id="time-out"
                    type="datetime-local"
                    value={draft.clockOut}
                    onChange={(event) => setDraft({ ...draft, clockOut: event.target.value })}
                  />
                </Field>
              </div>
              <Field label={t('correct.note')} htmlFor="time-note" error={save.fieldErrors.note}>
                <Input
                  id="time-note"
                  required
                  maxLength={200}
                  placeholder={t('correct.notePlaceholder')}
                  value={draft.note}
                  onChange={(event) => setDraft({ ...draft, note: event.target.value })}
                />
              </Field>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDraft(null)}>
                  {t('correct.cancel')}
                </Button>
                <Button type="submit" disabled={save.pending}>
                  {t('correct.save')}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
