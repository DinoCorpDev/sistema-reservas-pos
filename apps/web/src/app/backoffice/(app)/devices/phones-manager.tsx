'use client';

import type { people } from '@pos/api';
import { Badge } from '@pos/ui/badge';
import { Button } from '@pos/ui/button';
import { Avatar } from '@pos/ui/avatar';
import { Card, CardDescription, CardHeader, CardTitle } from '@pos/ui/card';
import { ConfirmButton } from '@pos/ui/confirm';
import { EmptyState } from '@pos/ui/empty-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@pos/ui/table';
import { PowerIcon, PowerOffIcon, SmartphoneIcon, UnplugIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useNow, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useDateTime } from '@/components/backoffice/people/use-date-time';
import { useServerAction } from '@/components/backoffice/use-server-action';
import * as actions from './actions';
import { type Pairing, PairingDialog } from './pairing-dialog';

/**
 * Waiters' own phones (DEC-036): who has one paired and since when. Phones appear when a waiter
 * pairs one; here the manager gives a code, unpairs a phone someone forgot to sign out of, or
 * stops a waiter from pairing their phone.
 */
export function PhonesManager({
  phones,
  canEdit,
}: {
  phones: people.TerminalDto[];
  canEdit: boolean;
}) {
  const t = useTranslations('phones');
  const tt = useTranslations('terminals');
  const tc = useTranslations('common');
  const formatDate = useDateTime();
  const now = useNow({ updateInterval: 60_000 });
  const router = useRouter();
  const [pairing, setPairing] = useState<Pairing | null>(null);

  const issue = useServerAction(
    async () => {
      const result = await actions.issuePhonePairingCode();
      return result.ok
        ? { ok: true as const, data: { ...result.data, kind: 'phone' as const } }
        : result;
    },
    { successMessage: false, onSuccess: setPairing },
  );
  const unpair = useServerAction((id: string) => actions.unpairTerminal(id), {
    successMessage: t('unpaired'),
  });
  const deactivate = useServerAction(
    (id: string) => actions.updateTerminal(id, { isActive: false }),
    { successMessage: t('deactivated') },
  );
  const activate = useServerAction((id: string) => actions.updateTerminal(id, { isActive: true }), {
    successMessage: t('activated'),
  });

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const pairingState = (phone: people.TerminalDto) => {
    if (!phone.isPaired || !phone.pairedAt)
      return (
        <Badge variant="secondary" dot>
          {tt('notPaired')}
        </Badge>
      );
    const stale = new Date(phone.pairedAt) < startOfToday;
    return (
      <div className="grid gap-1">
        <Badge variant={stale ? 'warning' : 'success'} dot>
          {t('pairedSince', { date: formatDate(phone.pairedAt) ?? '' })}
        </Badge>
        {stale ? <span className="text-xs text-muted-foreground">{t('stale')}</span> : null}
      </div>
    );
  };

  return (
    <Card className="mt-6">
      <CardHeader
        icon={<SmartphoneIcon />}
        action={
          canEdit ? (
            <Button variant="outline" onClick={() => void issue.run()} disabled={issue.pending}>
              <SmartphoneIcon /> {t('issue')}
            </Button>
          ) : null
        }
      >
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('hint')}</CardDescription>
      </CardHeader>
      {phones.length === 0 ? (
        <EmptyState icon={<SmartphoneIcon />} title={t('empty')} compact />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('waiter')}</TableHead>
              <TableHead>{tt('prefix')}</TableHead>
              <TableHead>{tt('pairing')}</TableHead>
              <TableHead>{tt('lastSeen')}</TableHead>
              <TableHead>{tc('status')}</TableHead>
              {canEdit ? <TableHead className="text-right">{tc('actions')}</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {phones.map((phone) => {
              const name = phone.userName ?? phone.name;
              return (
                <TableRow
                  key={phone.id}
                  className={phone.isActive ? undefined : 'opacity-60'}
                  data-testid="phone-row"
                >
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar name={name} colorKey={phone.userId ?? phone.id} />
                      <div className="min-w-0">
                        <p className="font-medium">{name}</p>
                        {phone.appVersion ? (
                          <p className="text-xs text-muted-foreground">v{phone.appVersion}</p>
                        ) : null}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="rounded-md bg-muted px-2 py-1 font-mono text-xs">
                      {phone.orderNumberPrefix}
                    </span>
                  </TableCell>
                  <TableCell>{pairingState(phone)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatDate(phone.lastSeenAt) ?? tt('never')}
                  </TableCell>
                  <TableCell>
                    <Badge variant={phone.isActive ? 'success' : 'secondary'} dot>
                      {phone.isActive ? tc('active') : tc('inactive')}
                    </Badge>
                  </TableCell>
                  {canEdit ? (
                    <TableCell className="text-right whitespace-nowrap">
                      {phone.isPaired ? (
                        <ConfirmButton
                          variant="ghost"
                          size="icon"
                          aria-label={t('unpair')}
                          disabled={unpair.pending}
                          title={t('unpairTitle', { name })}
                          description={t('unpairText')}
                          confirmLabel={t('unpair')}
                          cancelLabel={tc('cancel')}
                          onConfirm={() => unpair.run(phone.id)}
                        >
                          <UnplugIcon />
                        </ConfirmButton>
                      ) : null}
                      {phone.isActive ? (
                        <ConfirmButton
                          variant="ghost"
                          size="icon"
                          aria-label={t('deactivate')}
                          disabled={deactivate.pending}
                          title={t('deactivateTitle', { name })}
                          description={t('deactivateText')}
                          confirmLabel={tc('deactivate')}
                          cancelLabel={tc('cancel')}
                          onConfirm={() => deactivate.run(phone.id)}
                        >
                          <PowerOffIcon />
                        </ConfirmButton>
                      ) : (
                        <ConfirmButton
                          variant="ghost"
                          size="icon"
                          aria-label={t('activate')}
                          disabled={activate.pending}
                          title={t('activateTitle', { name })}
                          description={t('activateText')}
                          confirmLabel={tc('activate')}
                          cancelLabel={tc('cancel')}
                          onConfirm={() => activate.run(phone.id)}
                        >
                          <PowerIcon />
                        </ConfirmButton>
                      )}
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <PairingDialog
        pairing={pairing}
        renewing={issue.pending}
        onRenew={() => void issue.run()}
        onClose={() => {
          setPairing(null);
          // Phones may have paired meanwhile.
          router.refresh();
        }}
      />
    </Card>
  );
}
