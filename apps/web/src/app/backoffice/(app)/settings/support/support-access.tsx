'use client';

import type { admin } from '@pos/api';
import { Alert } from '@pos/ui/alert';
import { Badge } from '@pos/ui/badge';
import { Button } from '@pos/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@pos/ui/card';
import { ConfirmButton } from '@pos/ui/confirm';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@pos/ui/dialog';
import { Textarea } from '@pos/ui/input';
import { Field } from '@pos/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@pos/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@pos/ui/table';
import { ClockIcon, HistoryIcon, ShieldCheckIcon, ShieldOffIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { formatDateTime } from '@/components/backoffice/admin/format';
import { useServerAction } from '@/components/backoffice/use-server-action';
import * as actions from './actions';

const DURATIONS = [1, 4, 8, 24, 72] as const;

interface GrantDraft {
  hours: string;
  reason: string;
}

/** The owner's side of support access (RF-A10): explanation, grants, grant and revoke. */
export function SupportAccess({
  grants,
  userNames,
  canManage,
}: {
  grants: admin.SupportGrantDto[];
  userNames: Record<string, string>;
  canManage: boolean;
}) {
  const t = useTranslations('supportAccess');
  const tc = useTranslations('common');
  const [draft, setDraft] = useState<GrantDraft | null>(null);
  const grant = useServerAction(actions.grantSupportAccess, {
    successMessage: t('granted'),
    onSuccess: () => setDraft(null),
  });
  const revoke = useServerAction(actions.revokeSupportGrant, { successMessage: t('revoked') });

  const active = grants.filter((g) => g.active);
  const past = grants.filter((g) => !g.active);
  const staff = (g: admin.SupportGrantDto) => g.staffDisplayName ?? t('anyStaff');
  const grantedBy = (g: admin.SupportGrantDto) => userNames[g.grantedByUserId] ?? '—';

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('howTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-3">
            {[
              { icon: ShieldCheckIcon, text: t('how1') },
              { icon: HistoryIcon, text: t('how2') },
              { icon: ClockIcon, text: t('how3') },
            ].map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3">
                <Icon className="mt-0.5 size-5 shrink-0 text-brand-strong" aria-hidden />
                <span>{text}</span>
              </li>
            ))}
          </ul>
          {canManage ? null : <Alert variant="info">{t('onlyUsers')}</Alert>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>{t('active')}</CardTitle>
          {canManage ? (
            <Button onClick={() => setDraft({ hours: '4', reason: '' })}>
              <ShieldCheckIcon /> {t('grant')}
            </Button>
          ) : null}
        </CardHeader>
        {active.length === 0 ? (
          <p className="text-muted-foreground">{t('noActive')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('grantedAt')}</TableHead>
                <TableHead>{t('expiresAt')}</TableHead>
                <TableHead>{t('staff')}</TableHead>
                <TableHead>{t('reason')}</TableHead>
                <TableHead>{t('grantedBy')}</TableHead>
                {canManage ? <TableHead className="text-right">{tc('actions')}</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {active.map((g) => (
                <TableRow key={g.id}>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {formatDateTime(g.createdAt)}
                  </TableCell>
                  <TableCell className="font-medium whitespace-nowrap tabular-nums">
                    {formatDateTime(g.expiresAt)}
                  </TableCell>
                  <TableCell>{staff(g)}</TableCell>
                  <TableCell className="max-w-72 whitespace-normal">{g.reason ?? '—'}</TableCell>
                  <TableCell>{grantedBy(g)}</TableCell>
                  {canManage ? (
                    <TableCell className="text-right">
                      <ConfirmButton
                        variant="outline"
                        disabled={revoke.pending}
                        title={t('revokeTitle')}
                        description={t('revokeText')}
                        confirmLabel={t('revoke')}
                        cancelLabel={tc('cancel')}
                        onConfirm={() => revoke.run(g.id)}
                      >
                        <ShieldOffIcon /> {t('revoke')}
                      </ConfirmButton>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('past')}</CardTitle>
        </CardHeader>
        {past.length === 0 ? (
          <p className="text-muted-foreground">{t('noPast')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('grantedAt')}</TableHead>
                <TableHead>{t('expiresAt')}</TableHead>
                <TableHead>{t('staff')}</TableHead>
                <TableHead>{t('reason')}</TableHead>
                <TableHead>{t('grantedBy')}</TableHead>
                <TableHead>{t('status')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {past.map((g) => (
                <TableRow key={g.id}>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {formatDateTime(g.createdAt)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {formatDateTime(g.expiresAt)}
                  </TableCell>
                  <TableCell>{staff(g)}</TableCell>
                  <TableCell className="max-w-72 whitespace-normal">{g.reason ?? '—'}</TableCell>
                  <TableCell>{grantedBy(g)}</TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {g.revokedAt
                        ? t('statusRevoked', { date: formatDateTime(g.revokedAt) })
                        : t('statusExpired')}
                    </Badge>
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
                void grant.run({ hours: Number(draft.hours), reason: draft.reason, staffId: null });
              }}
            >
              <DialogHeader>
                <DialogTitle>{t('grant')}</DialogTitle>
                <DialogDescription>{t('how2')}</DialogDescription>
              </DialogHeader>
              <Field label={t('duration')} error={grant.fieldErrors.hours}>
                <Select
                  value={draft.hours}
                  onValueChange={(hours) => setDraft({ ...draft, hours })}
                >
                  <SelectTrigger aria-label={t('duration')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DURATIONS.map((hours) => (
                      <SelectItem key={hours} value={String(hours)}>
                        {t('hours', { count: hours })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field
                label={t('reason')}
                htmlFor="grant-reason"
                hint={t('reasonHint')}
                error={grant.fieldErrors.reason}
              >
                <Textarea
                  id="grant-reason"
                  required
                  autoFocus
                  maxLength={500}
                  value={draft.reason}
                  aria-invalid={!!grant.fieldErrors.reason}
                  onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
                />
              </Field>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDraft(null)}>
                  {tc('cancel')}
                </Button>
                <Button type="submit" disabled={grant.pending || draft.reason.trim() === ''}>
                  {t('grant')}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
