'use client';

import type { people } from '@pos/api';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, type Permission, type RoleKey } from '@pos/core';
import { Alert } from '@pos/ui/alert';
import { Badge } from '@pos/ui/badge';
import { Button } from '@pos/ui/button';
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@pos/ui/card';
import { RotateCcwIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { CheckOption } from '@/components/backoffice/people/check-option';
import { useServerAction } from '@/components/backoffice/use-server-action';
import * as actions from './actions';
import { useRoleLabel } from './use-role-label';

/** Permissions grouped by area of work, in the order of PERMISSIONS. */
const GROUPS: { key: string; permissions: readonly Permission[] }[] = [
  {
    key: 'orders',
    permissions: [
      'order.create',
      'order.void_item',
      'order.void',
      'order.discount',
      'order.reopen',
      'order.transfer',
      'order.any_table',
      'order.reassign',
    ],
  },
  { key: 'payments', permissions: ['payment.take', 'payment.refund', 'receipt.reprint'] },
  {
    key: 'cash',
    permissions: ['cash.open_drawer', 'cash.movement', 'shift.open', 'shift.close', 'day.close'],
  },
  {
    key: 'kitchen',
    permissions: [
      'kitchen.operate',
      'catalog.sold_out',
      'catalog.manage',
      'catalog.price_change',
      'tax.manage',
    ],
  },
  {
    key: 'guests',
    permissions: [
      'reservation.checkin',
      'reservation.manage',
      'customer.manage',
      'customer.anonymize',
    ],
  },
  {
    key: 'admin',
    permissions: [
      'location.manage',
      'user.manage',
      'report.view',
      'audit.view',
      'sync.resolve_conflicts',
      'support.grant_access',
      'approval.grant',
    ],
  },
];
// A permission added to the code later still shows up, under "Weitere".
const UNGROUPED = PERMISSIONS.filter((p) => !GROUPS.some((group) => group.permissions.includes(p)));
const ALL_GROUPS =
  UNGROUPED.length > 0 ? [...GROUPS, { key: 'other', permissions: UNGROUPED }] : GROUPS;

const ordered = (permissions: Iterable<string>) => {
  const set = new Set(permissions);
  return PERMISSIONS.filter((permission) => set.has(permission));
};
const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value) => b.includes(value));

/**
 * Checklist of permissions per role (RF-A04, RF-A05), saved role by role. Unsaved changes are kept
 * per role while switching between roles. The administrator role always has every permission.
 */
export function RolesManager({ roles, canEdit }: { roles: people.RoleDto[]; canEdit: boolean }) {
  const t = useTranslations('roles');
  const tg = useTranslations('permissionGroups');
  const tp = useTranslations('permissions');
  const tc = useTranslations('common');
  const roleLabel = useRoleLabel(roles);
  const [selectedId, setSelectedId] = useState(roles[0]?.id ?? null);
  const [drafts, setDrafts] = useState<Record<string, string[]>>({});
  const discard = (id: string) =>
    setDrafts((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  const save = useServerAction(
    (id: string, permissions: string[]) => actions.setRolePermissions(id, { permissions }),
    { successMessage: t('saved'), onSuccess: (role) => discard(role.id) },
  );

  const role = roles.find((r) => r.id === selectedId) ?? roles[0];
  if (!role) return <p className="text-muted-foreground">{tc('empty')}</p>;

  const permissionsOf = (r: people.RoleDto) =>
    r.key === 'admin' ? [...PERMISSIONS] : (drafts[r.id] ?? r.permissions);
  const isDirty = (r: people.RoleDto) => !!drafts[r.id] && !sameSet(drafts[r.id]!, r.permissions);

  const locked = role.key === 'admin';
  const editable = canEdit && !locked;
  const granted = new Set(permissionsOf(role));
  const dirty = isDirty(role);
  const defaults = DEFAULT_ROLE_PERMISSIONS[role.key as RoleKey] as readonly string[] | undefined;
  const label = (permission: string) => (tp.has(permission) ? tp(permission) : permission);

  const update = (change: (set: Set<string>) => void) => {
    const next = new Set(granted);
    change(next);
    setDrafts((current) => ({ ...current, [role.id]: ordered(next) }));
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label={t('choose')}>
        {roles.map((r) => (
          <Button
            key={r.id}
            variant={r.id === role.id ? 'default' : 'outline'}
            aria-pressed={r.id === role.id}
            onClick={() => setSelectedId(r.id)}
          >
            {roleLabel(r.key)}
            <span className="text-xs tabular-nums opacity-70">
              {permissionsOf(r).length}/{PERMISSIONS.length}
            </span>
            {isDirty(r) ? (
              <span className="size-2 rounded-full bg-warning">
                <span className="sr-only">{t('unsaved')}</span>
              </span>
            ) : null}
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
          <div className="grid gap-1">
            <CardTitle>{roleLabel(role.key)}</CardTitle>
            <CardDescription>
              {t('count', { count: granted.size, total: PERMISSIONS.length })}
            </CardDescription>
          </div>
          {dirty ? <Badge variant="warning">{t('unsaved')}</Badge> : null}
        </CardHeader>
        {locked ? (
          <Alert variant="info">{t('adminLocked')}</Alert>
        ) : (
          <p className="text-sm text-muted-foreground">{t('hint')}</p>
        )}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {ALL_GROUPS.map((group) => {
            const count = group.permissions.filter((p) => granted.has(p)).length;
            const all = count === group.permissions.length;
            return (
              <fieldset key={group.key} className="grid content-start rounded-lg border p-3">
                <legend className="sr-only">{tg(group.key)}</legend>
                <CheckOption
                  id={`role-${role.id}-group-${group.key}`}
                  label={<span className="font-semibold">{tg(group.key)}</span>}
                  checked={all ? true : count > 0 ? 'indeterminate' : false}
                  disabled={!editable}
                  onCheckedChange={() =>
                    update((set) =>
                      group.permissions.forEach((p) => (all ? set.delete(p) : set.add(p))),
                    )
                  }
                />
                <div className="mt-1 grid border-t pt-1 pl-2">
                  {group.permissions.map((permission) => (
                    <CheckOption
                      key={permission}
                      id={`role-${role.id}-${permission}`}
                      label={label(permission)}
                      checked={granted.has(permission)}
                      disabled={!editable}
                      onCheckedChange={(checked) =>
                        update((set) => (checked ? set.add(permission) : set.delete(permission)))
                      }
                    />
                  ))}
                </div>
              </fieldset>
            );
          })}
        </div>
        {editable ? (
          <CardFooter>
            {defaults ? (
              <Button
                variant="ghost"
                onClick={() =>
                  setDrafts((current) => ({ ...current, [role.id]: ordered(defaults) }))
                }
              >
                <RotateCcwIcon /> {t('defaults')}
              </Button>
            ) : null}
            <Button variant="outline" disabled={!drafts[role.id]} onClick={() => discard(role.id)}>
              {t('reset')}
            </Button>
            <Button
              disabled={!dirty || save.pending}
              onClick={() => void save.run(role.id, ordered(granted))}
            >
              {save.pending ? tc('saving') : tc('save')}
            </Button>
          </CardFooter>
        ) : null}
      </Card>
    </div>
  );
}
