'use client';

import type { people } from '@pos/api';
import { UI_LANGUAGES } from '@pos/core';
import { Badge } from '@pos/ui/badge';
import { Button } from '@pos/ui/button';
import { Card, CardHeader, CardTitle } from '@pos/ui/card';
import { ConfirmButton } from '@pos/ui/confirm';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@pos/ui/dialog';
import { Input } from '@pos/ui/input';
import { Field } from '@pos/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@pos/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@pos/ui/table';
import {
  HashIcon,
  LockKeyholeIcon,
  PencilIcon,
  PlusIcon,
  UserCheckIcon,
  UserXIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { CheckOption } from '@/components/backoffice/people/check-option';
import { useDateTime } from '@/components/backoffice/people/use-date-time';
import { useServerAction } from '@/components/backoffice/use-server-action';
import * as actions from './actions';
import { PasswordForm, PinForm } from './credential-forms';
import { useRoleLabel } from './use-role-label';

type LocationOption = { id: string; name: string };

type UserDraft = {
  id?: string;
  displayName: string;
  email: string;
  /** Only when creating; afterwards through "Passwort setzen". */
  password: string;
  /** Only when creating; afterwards through "PIN setzen". */
  pin: string;
  uiLanguage: string;
  roles: string[];
  locationIds: string[];
};

type OpenDialog =
  | { kind: 'user'; draft: UserDraft }
  | { kind: 'pin'; user: people.UserDto }
  | { kind: 'password'; user: people.UserDto }
  | null;

/** Staff of the organization: roles, locations, PIN and backoffice access (RF-A04, RF-A06, RF-A12). */
export function UsersManager({
  users,
  roles,
  locations,
  currentUserId,
  canEdit,
}: {
  users: people.UserDto[];
  roles: people.RoleDto[];
  locations: LocationOption[];
  currentUserId: string | null;
  canEdit: boolean;
}) {
  const t = useTranslations('users');
  const tc = useTranslations('common');
  const formatDate = useDateTime();
  const roleLabel = useRoleLabel(roles);
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const close = () => setDialog(null);

  const deactivate = useServerAction((id: string) => actions.setUserActive(id, false), {
    successMessage: t('deactivated'),
  });
  const activate = useServerAction((id: string) => actions.setUserActive(id, true), {
    successMessage: t('activated'),
  });

  const locationNames = (ids: string[]) => {
    if (locations.length > 1 && locations.every((location) => ids.includes(location.id))) {
      return t('allLocations');
    }
    const names = locations.filter((location) => ids.includes(location.id)).map((l) => l.name);
    return names.length > 0 ? names.join(', ') : '—';
  };
  const yesNo = (value: boolean) => (
    <Badge variant={value ? 'success' : 'secondary'}>{value ? tc('yes') : tc('no')}</Badge>
  );

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>{t('tabUsers')}</CardTitle>
        {canEdit ? (
          <Button
            onClick={() =>
              setDialog({
                kind: 'user',
                draft: {
                  displayName: '',
                  email: '',
                  password: '',
                  pin: '',
                  uiLanguage: 'de',
                  roles: [],
                  locationIds: locations.length === 1 ? [locations[0]!.id] : [],
                },
              })
            }
          >
            <PlusIcon /> {t('new')}
          </Button>
        ) : null}
      </CardHeader>
      {users.length === 0 ? (
        <p className="text-muted-foreground">{t('empty')}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('name')}</TableHead>
              <TableHead>{t('email')}</TableHead>
              <TableHead>{t('roles')}</TableHead>
              <TableHead>{t('locations')}</TableHead>
              <TableHead>{t('pinSet')}</TableHead>
              <TableHead>{t('twoFactor')}</TableHead>
              <TableHead>{tc('status')}</TableHead>
              <TableHead>{t('lastLogin')}</TableHead>
              {canEdit ? <TableHead className="text-right">{tc('actions')}</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id} className={user.isActive ? undefined : 'opacity-60'}>
                <TableCell className="font-medium">
                  <span className="inline-flex flex-wrap items-center gap-2">
                    {user.displayName}
                    {user.id === currentUserId ? <Badge variant="outline">{t('you')}</Badge> : null}
                  </span>
                </TableCell>
                <TableCell className="break-all">{user.email ?? '—'}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {user.roles.map((key) => (
                      <Badge key={key} variant="secondary">
                        {roleLabel(key)}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell>{locationNames(user.locationIds)}</TableCell>
                <TableCell>{yesNo(user.hasPin)}</TableCell>
                <TableCell>{yesNo(user.twoFactorEnabled)}</TableCell>
                <TableCell>
                  <Badge variant={user.isActive ? 'success' : 'secondary'}>
                    {user.isActive ? tc('active') : tc('inactive')}
                  </Badge>
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {formatDate(user.lastLoginAt) ?? t('never')}
                </TableCell>
                {canEdit ? (
                  <TableCell className="text-right whitespace-nowrap">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={tc('edit')}
                      title={tc('edit')}
                      onClick={() =>
                        setDialog({
                          kind: 'user',
                          draft: {
                            id: user.id,
                            displayName: user.displayName,
                            email: user.email ?? '',
                            password: '',
                            pin: '',
                            uiLanguage: user.uiLanguage,
                            roles: user.roles,
                            // Only locations that still exist, or saving would fail with 404.
                            locationIds: user.locationIds.filter((id) =>
                              locations.some((location) => location.id === id),
                            ),
                          },
                        })
                      }
                    >
                      <PencilIcon />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('setPin')}
                      title={t('setPin')}
                      onClick={() => setDialog({ kind: 'pin', user })}
                    >
                      <HashIcon />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('setPassword')}
                      title={t('setPassword')}
                      onClick={() => setDialog({ kind: 'password', user })}
                    >
                      <LockKeyholeIcon />
                    </Button>
                    {user.isActive ? (
                      <ConfirmButton
                        variant="ghost"
                        size="icon"
                        aria-label={t('deactivate')}
                        disabled={deactivate.pending}
                        title={t('deactivateTitle', { name: user.displayName })}
                        description={t('deactivateText')}
                        confirmLabel={tc('deactivate')}
                        cancelLabel={tc('cancel')}
                        onConfirm={() => deactivate.run(user.id)}
                      >
                        <UserXIcon />
                      </ConfirmButton>
                    ) : (
                      <ConfirmButton
                        variant="ghost"
                        size="icon"
                        aria-label={t('activate')}
                        disabled={activate.pending}
                        title={t('activateTitle', { name: user.displayName })}
                        description={t('activateText')}
                        confirmLabel={tc('activate')}
                        cancelLabel={tc('cancel')}
                        onConfirm={() => activate.run(user.id)}
                      >
                        <UserCheckIcon />
                      </ConfirmButton>
                    )}
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={!!dialog} onOpenChange={(open) => !open && close()}>
        <DialogContent
          closeLabel={tc('close')}
          className={dialog?.kind === 'user' ? 'sm:max-w-2xl' : undefined}
        >
          {dialog?.kind === 'user' ? (
            <UserForm
              initial={dialog.draft}
              roles={roles}
              locations={locations}
              onCancel={close}
              onSaved={close}
            />
          ) : dialog?.kind === 'pin' ? (
            <PinForm user={dialog.user} onCancel={close} onSaved={close} />
          ) : dialog?.kind === 'password' ? (
            <PasswordForm user={dialog.user} onCancel={close} onSaved={close} />
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/** Create/edit form; mounted per dialog opening so its field errors start empty. */
function UserForm({
  initial,
  roles,
  locations,
  onCancel,
  onSaved,
}: {
  initial: UserDraft;
  roles: people.RoleDto[];
  locations: LocationOption[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('users');
  const tc = useTranslations('common');
  const tl = useTranslations('languages');
  const roleLabel = useRoleLabel(roles);
  const isNew = !initial.id;
  const [form, setForm] = useState(initial);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const save = useServerAction(
    (draft: UserDraft) => {
      const body = {
        displayName: draft.displayName,
        email: draft.email.trim() || null,
        uiLanguage: draft.uiLanguage,
        roles: draft.roles,
        locationIds: draft.locationIds,
      };
      return draft.id
        ? actions.updateUser(draft.id, body)
        : actions.createUser({ ...body, password: draft.password || null, pin: draft.pin || null });
    },
    { successMessage: isNew ? t('created') : undefined, onSuccess: onSaved },
  );
  const error = (key: string) => problems[key] ?? save.fieldErrors[key];

  const toggle = (key: 'roles' | 'locationIds', value: string, checked: boolean) =>
    setForm((f) => ({
      ...f,
      [key]: checked ? [...new Set([...f[key], value])] : f[key].filter((v) => v !== value),
    }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found: Record<string, string> = {};
    if (form.roles.length === 0) found.roles = t('pickRole');
    if (form.locationIds.length === 0) found.locationIds = t('pickLocation');
    if (isNew && form.password && !form.email.trim()) found.email = t('passwordNeedsEmail');
    if (isNew && form.pin && !/^\d{4,6}$/.test(form.pin)) found.pin = t('pinInvalid');
    setProblems(found);
    if (Object.keys(found).length === 0) void save.run(form);
  };

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>{isNew ? t('new') : t('edit')}</DialogTitle>
      </DialogHeader>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('name')} htmlFor="user-name" error={error('displayName')}>
          <Input
            id="user-name"
            required
            autoFocus
            maxLength={100}
            autoComplete="off"
            value={form.displayName}
            aria-invalid={!!error('displayName')}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
          />
        </Field>
        <Field label={t('email')} htmlFor="user-email" hint={t('emailHint')} error={error('email')}>
          <Input
            id="user-email"
            type="email"
            maxLength={254}
            autoComplete="off"
            value={form.email}
            aria-invalid={!!error('email')}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </Field>
        {isNew ? (
          <>
            <Field
              label={t('password')}
              htmlFor="user-password"
              hint={t('passwordHint')}
              error={error('password')}
            >
              <Input
                id="user-password"
                type="password"
                minLength={10}
                maxLength={200}
                autoComplete="new-password"
                value={form.password}
                aria-invalid={!!error('password')}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </Field>
            <Field label={t('pin')} htmlFor="user-pin" hint={t('pinHint')} error={error('pin')}>
              <Input
                id="user-pin"
                type="password"
                inputMode="numeric"
                pattern="[0-9]{4,6}"
                maxLength={6}
                autoComplete="off"
                className="font-mono tracking-widest"
                value={form.pin}
                aria-invalid={!!error('pin')}
                onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, '') })}
              />
            </Field>
          </>
        ) : null}
        <Field label={t('uiLanguage')} htmlFor="user-language" error={error('uiLanguage')}>
          <Select
            value={form.uiLanguage}
            onValueChange={(uiLanguage) => setForm({ ...form, uiLanguage })}
          >
            <SelectTrigger id="user-language">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {UI_LANGUAGES.map((code) => (
                <SelectItem key={code} value={code}>
                  {tl(code)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <fieldset className="grid gap-1">
        <legend className="mb-1 text-sm font-medium">{t('roles')}</legend>
        <div className="grid gap-x-6 sm:grid-cols-2">
          {roles.map((role) => (
            <CheckOption
              key={role.id}
              id={`user-role-${role.key}`}
              label={roleLabel(role.key)}
              checked={form.roles.includes(role.key)}
              onCheckedChange={(checked) => toggle('roles', role.key, checked)}
            />
          ))}
        </div>
        <FieldMessage error={error('roles')} hint={t('rolesHint')} />
      </fieldset>

      <fieldset className="grid gap-1">
        <legend className="mb-1 text-sm font-medium">{t('locations')}</legend>
        <div className="grid gap-x-6 sm:grid-cols-2">
          {locations.map((location) => (
            <CheckOption
              key={location.id}
              id={`user-location-${location.id}`}
              label={location.name}
              checked={form.locationIds.includes(location.id)}
              onCheckedChange={(checked) => toggle('locationIds', location.id, checked)}
            />
          ))}
        </div>
        <FieldMessage error={error('locationIds')} />
      </fieldset>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {tc('cancel')}
        </Button>
        <Button type="submit" disabled={save.pending}>
          {save.pending ? tc('saving') : isNew ? tc('create') : tc('save')}
        </Button>
      </DialogFooter>
    </form>
  );
}

function FieldMessage({ error, hint }: { error?: string; hint?: string }) {
  if (error) {
    return (
      <p className="text-sm text-destructive" role="alert">
        {error}
      </p>
    );
  }
  return hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null;
}
