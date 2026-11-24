'use client';

import type { people } from '@pos/api';
import { ActionGroup } from '@pos/ui/action-group';
import { Avatar } from '@pos/ui/avatar';
import { Badge } from '@pos/ui/badge';
import { Button } from '@pos/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@pos/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@pos/ui/dialog';
import { QrCode } from '@pos/ui/qr-code';
import { CheckIcon, CopyIcon, QrCodeIcon, UserRoundPlusIcon, XIcon } from 'lucide-react';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useServerAction } from '@/components/backoffice/use-server-action';
import * as actions from './actions';

/**
 * "Invite a waiter" (DEC-055): a QR that opens `/join` with a code on the new waiter's phone,
 * valid an hour for up to ten people. The code is shown once and never stored in clear.
 */
export function InviteWaiterButton() {
  const t = useTranslations('users.join');
  const format = useFormatter();
  const [invite, setInvite] = useState<people.StaffInviteDto | null>(null);
  const [copied, setCopied] = useState(false);
  const issue = useServerAction(actions.issueStaffInvite, {
    successMessage: false,
    onSuccess: (data) => {
      setCopied(false);
      setInvite(data);
    },
  });
  const link = invite
    ? `${window.location.origin}/join?code=${encodeURIComponent(invite.code)}`
    : '';

  return (
    <>
      <Button onClick={() => void issue.run()} disabled={issue.pending}>
        <QrCodeIcon /> {t('invite')}
      </Button>
      <Dialog open={!!invite} onOpenChange={(open) => !open && setInvite(null)}>
        <DialogContent closeLabel={t('close')} className="sm:max-w-md">
          {invite ? (
            <div className="grid gap-4">
              <DialogHeader>
                <DialogTitle>{t('title')}</DialogTitle>
                <DialogDescription>{t('hint')}</DialogDescription>
              </DialogHeader>
              <div className="mx-auto w-full max-w-64 rounded-xl border bg-white p-3">
                <QrCode value={link} label={t('qrLabel')} />
              </div>
              <div className="grid gap-1 text-center">
                <p className="text-sm text-muted-foreground">{t('orCode')}</p>
                <p
                  className="font-mono text-3xl font-semibold tracking-[0.2em]"
                  data-testid="invite-code"
                >
                  {invite.code}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t('valid', {
                    time: format.dateTime(new Date(invite.expiresAt), { timeStyle: 'short' }),
                    count: invite.maxUses,
                  })}
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  void navigator.clipboard?.writeText(link).then(() => setCopied(true));
                }}
              >
                {copied ? <CheckIcon /> : <CopyIcon />} {copied ? t('copied') : t('copy')}
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** People who joined from their phone and wait for a manager (DEC-055). */
export function PendingRegistrations({
  registrations,
}: {
  registrations: people.StaffRegistrationDto[];
}) {
  const t = useTranslations('users.join');
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const approve = useServerAction(actions.approveRegistration, { successMessage: t('approved') });
  const reject = useServerAction(actions.rejectRegistration, { successMessage: t('rejected') });
  if (registrations.length === 0) return null;
  const busy = approve.pending || reject.pending;

  return (
    <Card className="mb-6 border-brand/40" data-testid="pending-registrations">
      <CardHeader
        icon={<UserRoundPlusIcon />}
        action={<Badge variant="info">{registrations.length}</Badge>}
      >
        <CardTitle>{t('pendingTitle')}</CardTitle>
        <CardDescription>{t('pendingHint')}</CardDescription>
      </CardHeader>
      <ul className="grid gap-2">
        {registrations.map((registration) => (
          <li
            key={registration.id}
            className="flex flex-wrap items-center gap-3 rounded-xl border bg-surface-2 p-3"
            data-testid={`registration-${registration.displayName}`}
          >
            <Avatar name={registration.displayName} colorKey={registration.id} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{registration.displayName}</p>
              <p className="text-sm text-muted-foreground">
                {t('joined', {
                  when: format.relativeTime(new Date(registration.createdAt), now),
                  language: registration.uiLanguage.toUpperCase(),
                })}
              </p>
            </div>
            <ActionGroup label={registration.displayName}>
              <Button
                variant="ghost"
                aria-label={`${t('reject')}: ${registration.displayName}`}
                disabled={busy}
                onClick={() => void reject.run(registration.id)}
              >
                <XIcon /> {t('reject')}
              </Button>
              <Button
                variant="ghost"
                aria-label={`${t('approve')}: ${registration.displayName}`}
                disabled={busy}
                onClick={() => void approve.run(registration.id)}
              >
                <CheckIcon /> {t('approve')}
              </Button>
            </ActionGroup>
          </li>
        ))}
      </ul>
    </Card>
  );
}
