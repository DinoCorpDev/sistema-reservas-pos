'use client';

import type { admin } from '@pos/api';
import { AUDIT_ACTIONS } from '@pos/core';
import { Button } from '@pos/ui/button';
import { Card, CardHeader, CardTitle } from '@pos/ui/card';
import { Input } from '@pos/ui/input';
import { Field } from '@pos/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@pos/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@pos/ui/table';
import { EmptyState } from '@pos/ui/empty-state';
import {
  ChevronDownIcon,
  ChevronUpIcon,
  DownloadIcon,
  FilterIcon,
  RotateCcwIcon,
  ScrollTextIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Fragment, useState, useTransition } from 'react';
import { formatDateTime, shortId } from '@/components/backoffice/admin/format';
import { useServerAction } from '@/components/backoffice/use-server-action';
import { loadMoreAuditEvents } from './actions';
import { AUDIT_ENTITY_TYPES, type AuditFilters } from './filters';

const ALL = 'all';
const COLUMNS = 8;

interface NamedRef {
  id: string;
  name: string;
}

function JsonBlock({ title, value, empty }: { title: string; value: unknown; empty: string }) {
  return (
    <div className="grid min-w-0 gap-1">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</p>
      {value === null || value === undefined ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap break-all">
          {JSON.stringify(value, null, 2)}
        </pre>
      )}
    </div>
  );
}

/** Audit log with filters, expandable before/after state and cursor paging (RF-F12). */
export function AuditLog({
  filters,
  initial,
  users,
  terminals,
}: {
  filters: AuditFilters;
  initial: admin.AuditPageDto;
  users: NamedRef[];
  terminals: NamedRef[];
}) {
  const t = useTranslations('audit');
  const ta = useTranslations('auditActions');
  const router = useRouter();
  const [draft, setDraft] = useState<AuditFilters>(filters);
  const [items, setItems] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [navigating, startNavigation] = useTransition();

  const more = useServerAction(loadMoreAuditEvents, {
    successMessage: false,
    onSuccess: (page) => {
      setItems((current) => [...current, ...page.items]);
      setCursor(page.nextCursor);
    },
  });

  const userName = new Map(users.map((u) => [u.id, u.name]));
  const terminalName = new Map(terminals.map((d) => [d.id, d.name]));
  const actionLabel = (action: string) => (ta.has(action) ? ta(action) : action);
  const entityLabel = (type: string) =>
    t.has(`entityTypes.${type}`) ? t(`entityTypes.${type}`) : type;
  const person = (id: string | null) => (id ? (userName.get(id) ?? shortId(id)) : null);

  const queryOf = (next: AuditFilters) => {
    const params = new URLSearchParams();
    if (next.from) params.set('from', next.from);
    if (next.to) params.set('to', next.to);
    if (next.action) params.set('action', next.action);
    if (next.entityType) params.set('entity', next.entityType);
    if (next.userId.trim()) params.set('user', next.userId.trim());
    if (next.terminalId) params.set('terminal', next.terminalId);
    return params;
  };
  const apply = (next: AuditFilters) => {
    const query = queryOf(next).toString();
    startNavigation(() => router.push(query ? `/backoffice/audit?${query}` : '/backoffice/audit'));
  };
  /** The applied filters as a file (RF-F12): the same events, all pages. */
  const exportHref = (format: 'csv' | 'json') => {
    const params = queryOf(filters);
    params.set('format', format);
    return `/backoffice/audit/export?${params.toString()}`;
  };

  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const hasFilters = Object.values(filters).some(Boolean);

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('filters')}</CardTitle>
        </CardHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            apply(draft);
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label={t('from')} htmlFor="audit-from">
              <Input
                id="audit-from"
                type="date"
                max={draft.to || undefined}
                value={draft.from}
                onChange={(e) => setDraft({ ...draft, from: e.target.value })}
              />
            </Field>
            <Field label={t('to')} htmlFor="audit-to">
              <Input
                id="audit-to"
                type="date"
                min={draft.from || undefined}
                value={draft.to}
                onChange={(e) => setDraft({ ...draft, to: e.target.value })}
              />
            </Field>
            <Field label={t('action')}>
              <Select
                value={draft.action || ALL}
                onValueChange={(value) =>
                  setDraft({ ...draft, action: value === ALL ? '' : value })
                }
              >
                <SelectTrigger aria-label={t('action')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{t('allActions')}</SelectItem>
                  {AUDIT_ACTIONS.map((action) => (
                    <SelectItem key={action} value={action}>
                      {actionLabel(action)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t('entityType')}>
              <Select
                value={draft.entityType || ALL}
                onValueChange={(value) =>
                  setDraft({ ...draft, entityType: value === ALL ? '' : value })
                }
              >
                <SelectTrigger aria-label={t('entityType')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{t('allEntityTypes')}</SelectItem>
                  {AUDIT_ENTITY_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {entityLabel(type)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {users.length > 0 ? (
              <Field label={t('user')}>
                <Select
                  value={draft.userId || ALL}
                  onValueChange={(value) =>
                    setDraft({ ...draft, userId: value === ALL ? '' : value })
                  }
                >
                  <SelectTrigger aria-label={t('user')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>{t('allUsers')}</SelectItem>
                    {users.map((user) => (
                      <SelectItem key={user.id} value={user.id}>
                        {user.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            ) : (
              <Field label={t('userId')} htmlFor="audit-user" hint={t('userIdHint')}>
                <Input
                  id="audit-user"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={36}
                  className="font-mono"
                  value={draft.userId}
                  onChange={(e) => setDraft({ ...draft, userId: e.target.value })}
                />
              </Field>
            )}
            {terminals.length > 0 ? (
              <Field label={t('terminal')}>
                <Select
                  value={draft.terminalId || ALL}
                  onValueChange={(value) =>
                    setDraft({ ...draft, terminalId: value === ALL ? '' : value })
                  }
                >
                  <SelectTrigger aria-label={t('terminal')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>{t('allTerminals')}</SelectItem>
                    {terminals.map((terminal) => (
                      <SelectItem key={terminal.id} value={terminal.id}>
                        {terminal.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={navigating}>
              <FilterIcon /> {t('apply')}
            </Button>
            {hasFilters ? (
              <Button
                type="button"
                variant="ghost"
                disabled={navigating}
                onClick={() => startNavigation(() => router.push('/backoffice/audit'))}
              >
                <RotateCcwIcon /> {t('reset')}
              </Button>
            ) : null}
            <Button asChild variant="outline" className="ml-auto">
              <a href={exportHref('csv')} download data-testid="audit-export-csv">
                <DownloadIcon /> {t('exportCsv')}
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href={exportHref('json')} download>
                <DownloadIcon /> {t('exportJson')}
              </a>
            </Button>
          </div>
        </form>
      </Card>

      {items.length === 0 ? (
        <EmptyState compact icon={<ScrollTextIcon />} title={t('empty')} />
      ) : (
        <div className="grid gap-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('time')}</TableHead>
                <TableHead>{t('action')}</TableHead>
                <TableHead>{t('entity')}</TableHead>
                <TableHead>{t('user')}</TableHead>
                <TableHead>{t('approver')}</TableHead>
                <TableHead>{t('terminal')}</TableHead>
                <TableHead>{t('reason')}</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">{t('changes')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((event) => {
                const open = expanded.has(event.id);
                const bySupport = !event.userId && !!event.requestId?.startsWith('support:');
                return (
                  <Fragment key={event.id}>
                    <TableRow>
                      <TableCell className="whitespace-nowrap tabular-nums">
                        {formatDateTime(event.occurredAt, { seconds: true })}
                      </TableCell>
                      <TableCell className="font-medium">{actionLabel(event.action)}</TableCell>
                      <TableCell>
                        <span className="block">{entityLabel(event.entityType)}</span>
                        {event.entityId ? (
                          <span
                            className="font-mono text-xs text-muted-foreground"
                            title={event.entityId}
                          >
                            {shortId(event.entityId)}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {bySupport ? t('support') : (person(event.userId) ?? '—')}
                      </TableCell>
                      <TableCell>{person(event.authorizedByUserId) ?? '—'}</TableCell>
                      <TableCell>
                        {event.terminalId
                          ? (terminalName.get(event.terminalId) ?? shortId(event.terminalId))
                          : '—'}
                      </TableCell>
                      <TableCell className="max-w-64 whitespace-normal">
                        {event.reason ?? '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-expanded={open}
                          aria-controls={`audit-${event.id}`}
                          aria-label={open ? t('hideChanges') : t('showChanges')}
                          onClick={() => toggle(event.id)}
                        >
                          {open ? <ChevronUpIcon /> : <ChevronDownIcon />}
                        </Button>
                      </TableCell>
                    </TableRow>
                    {open ? (
                      <TableRow id={`audit-${event.id}`} className="bg-muted/30 hover:bg-muted/30">
                        <TableCell colSpan={COLUMNS}>
                          <div className="grid gap-3 md:grid-cols-2">
                            <JsonBlock
                              title={t('before')}
                              value={event.before}
                              empty={t('noData')}
                            />
                            <JsonBlock title={t('after')} value={event.after} empty={t('noData')} />
                          </div>
                          {event.requestId ? (
                            <p className="mt-2 font-mono text-xs text-muted-foreground">
                              {t('request')}: {event.requestId}
                            </p>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">{t('shown', { count: items.length })}</p>
            {cursor ? (
              <Button
                variant="outline"
                disabled={more.pending}
                onClick={() => void more.run(filters, cursor)}
              >
                {t('loadMore')}
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">{t('allLoaded')}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
