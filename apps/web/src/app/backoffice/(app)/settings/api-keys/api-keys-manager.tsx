'use client';

import type { people } from '@pos/api';
import { Alert, AlertDescription, AlertTitle } from '@pos/ui/alert';
import { Badge } from '@pos/ui/badge';
import { Button } from '@pos/ui/button';
import { Card, CardHeader, CardTitle } from '@pos/ui/card';
import { ConfirmButton } from '@pos/ui/confirm';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@pos/ui/dialog';
import { Input } from '@pos/ui/input';
import { Field } from '@pos/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@pos/ui/table';
import { toast } from '@pos/ui/toaster';
import { BanIcon, CheckIcon, CopyIcon, PlusIcon, TriangleAlertIcon } from 'lucide-react';
import { useNow, useTranslations } from 'next-intl';
import { useState } from 'react';
import { CheckOption } from '@/components/backoffice/people/check-option';
import { useDateTime } from '@/components/backoffice/people/use-date-time';
import { useServerAction } from '@/components/backoffice/use-server-action';
import * as actions from './actions';

/**
 * Scopes a key can be given. Mirrors `API_KEY_SCOPES` in packages/api/src/auth/api-keys.ts, which
 * @pos/api does not export; the server validates them anyway (422 for an unknown scope).
 */
const API_KEY_SCOPES = ['catalog:read', 'catalog:write', 'customers:write', 'reservations:write'];

type CreatedKey = { name: string; key: string };

/** Message key of a scope: next-intl keys cannot contain `:` safely, so `catalog:read` → `catalog_read`. */
const scopeKey = (scope: string) => scope.replace(/:/g, '_');

/** API keys of the organization (RF-F14): list, create (the key is shown once) and revoke. */
export function ApiKeysManager({ keys }: { keys: people.ApiKeyDto[] }) {
  const t = useTranslations('apiKeys');
  const tc = useTranslations('common');
  const formatDate = useDateTime();
  const now = useNow();
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedKey | null>(null);
  const revoke = useServerAction(actions.revokeApiKey, { successMessage: t('revoked') });
  const scopeName = (scope: string) =>
    t.has(`scopeNames.${scopeKey(scope)}`) ? t(`scopeNames.${scopeKey(scope)}`) : scope;

  const status = (key: people.ApiKeyDto) => {
    if (key.revokedAt) {
      return (
        <div className="grid gap-1">
          <Badge variant="destructive">{t('statusRevoked')}</Badge>
          <span className="text-xs text-muted-foreground">{formatDate(key.revokedAt)}</span>
        </div>
      );
    }
    if (key.expiresAt && new Date(key.expiresAt).getTime() <= now.getTime()) {
      return <Badge variant="secondary">{t('statusExpired')}</Badge>;
    }
    return <Badge variant="success">{t('statusActive')}</Badge>;
  };

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>{t('listTitle')}</CardTitle>
        <Button onClick={() => setCreating(true)}>
          <PlusIcon /> {t('new')}
        </Button>
      </CardHeader>
      {keys.length === 0 ? (
        <p className="text-muted-foreground">{t('empty')}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('name')}</TableHead>
              <TableHead>{t('prefix')}</TableHead>
              <TableHead>{t('scopes')}</TableHead>
              <TableHead>{t('created')}</TableHead>
              <TableHead>{t('lastUsed')}</TableHead>
              <TableHead>{tc('status')}</TableHead>
              <TableHead className="text-right">{tc('actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {keys.map((key) => (
              <TableRow key={key.id} className={key.revokedAt ? 'opacity-60' : undefined}>
                <TableCell className="font-medium">{key.name}</TableCell>
                <TableCell className="font-mono text-xs whitespace-nowrap">
                  {key.keyPrefix}…
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {key.scopes.map((scope) => (
                      <Badge key={scope} variant="secondary" title={scope}>
                        {scopeName(scope)}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap">{formatDate(key.createdAt)}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {formatDate(key.lastUsedAt) ?? t('never')}
                </TableCell>
                <TableCell>{status(key)}</TableCell>
                <TableCell className="text-right">
                  {key.revokedAt ? null : (
                    <ConfirmButton
                      variant="outline"
                      disabled={revoke.pending}
                      title={t('revokeTitle', { name: key.name })}
                      description={t('revokeText')}
                      confirmLabel={t('revoke')}
                      cancelLabel={tc('cancel')}
                      onConfirm={() => revoke.run(key.id)}
                    >
                      <BanIcon /> {t('revoke')}
                    </ConfirmButton>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent closeLabel={tc('close')}>
          {creating ? (
            <CreateKeyForm
              onCancel={() => setCreating(false)}
              onCreated={(key) => {
                setCreating(false);
                setCreated(key);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={!!created} onOpenChange={(open) => !open && setCreated(null)}>
        {/* The key is never shown again: a tap outside must not close it by accident. */}
        <DialogContent
          closeLabel={tc('close')}
          onInteractOutside={(event) => event.preventDefault()}
        >
          {created ? <CreatedKeyView created={created} onDone={() => setCreated(null)} /> : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/** Name and scopes; mounted per dialog opening so its field errors start empty. */
function CreateKeyForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (key: CreatedKey) => void;
}) {
  const t = useTranslations('apiKeys');
  const tc = useTranslations('common');
  const [form, setForm] = useState({ name: '', scopes: ['catalog:read'] });
  const [problem, setProblem] = useState<string>();
  const save = useServerAction(actions.createApiKey, {
    successMessage: false,
    onSuccess: (key) => onCreated({ name: key.name, key: key.key }),
  });
  const scopesError = problem ?? save.fieldErrors.scopes;

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (form.scopes.length === 0) return setProblem(t('pickScope'));
        setProblem(undefined);
        void save.run(form);
      }}
    >
      <DialogHeader>
        <DialogTitle>{t('new')}</DialogTitle>
      </DialogHeader>
      <Field
        label={t('name')}
        htmlFor="api-key-name"
        hint={t('nameHint')}
        error={save.fieldErrors.name}
      >
        <Input
          id="api-key-name"
          required
          autoFocus
          maxLength={100}
          autoComplete="off"
          value={form.name}
          aria-invalid={!!save.fieldErrors.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </Field>
      <fieldset className="grid gap-1">
        <legend className="mb-1 text-sm font-medium">{t('scopes')}</legend>
        {API_KEY_SCOPES.map((scope) => (
          <CheckOption
            key={scope}
            id={`api-key-scope-${scopeKey(scope)}`}
            label={
              <>
                {t(`scopeNames.${scopeKey(scope)}`)}{' '}
                <span className="font-mono text-xs font-normal text-muted-foreground">{scope}</span>
              </>
            }
            description={t(`scopeDescriptions.${scopeKey(scope)}`)}
            checked={form.scopes.includes(scope)}
            onCheckedChange={(checked) =>
              setForm({
                ...form,
                scopes: checked
                  ? API_KEY_SCOPES.filter((s) => s === scope || form.scopes.includes(s))
                  : form.scopes.filter((s) => s !== scope),
              })
            }
          />
        ))}
        {scopesError ? (
          <p className="text-sm text-destructive" role="alert">
            {scopesError}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">{t('scopesHint')}</p>
        )}
      </fieldset>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {tc('cancel')}
        </Button>
        <Button type="submit" disabled={save.pending}>
          {tc('create')}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** The new key, shown this once, with a copy button and a warning. */
function CreatedKeyView({ created, onDone }: { created: CreatedKey; onDone: () => void }) {
  const t = useTranslations('apiKeys');
  const tc = useTranslations('common');
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      // Needs a secure context (HTTPS or localhost); otherwise the key can be selected by hand.
      await navigator.clipboard.writeText(created.key);
      setCopied(true);
      toast.success(tc('copied'));
    } catch {
      toast.error(t('copyFailed'));
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('keyTitle', { name: created.name })}</DialogTitle>
      </DialogHeader>
      <Alert variant="warning">
        <AlertTitle className="flex items-center gap-2">
          <TriangleAlertIcon className="size-4 shrink-0" aria-hidden /> {t('keyWarningTitle')}
        </AlertTitle>
        <AlertDescription>{t('keyWarning')}</AlertDescription>
      </Alert>
      <Field label={t('keyLabel')} htmlFor="api-key-value">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="api-key-value"
            readOnly
            value={created.key}
            spellCheck={false}
            className="font-mono text-sm"
            onFocus={(event) => event.currentTarget.select()}
          />
          <Button type="button" variant="outline" onClick={() => void copy()}>
            {copied ? <CheckIcon /> : <CopyIcon />} {copied ? tc('copied') : tc('copy')}
          </Button>
        </div>
      </Field>
      <DialogFooter>
        <Button onClick={onDone}>{t('keyDone')}</Button>
      </DialogFooter>
    </>
  );
}
