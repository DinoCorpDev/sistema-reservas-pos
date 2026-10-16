'use client';

import type { admin } from '@pos/api';
import { Badge } from '@pos/ui/badge';
import { Button } from '@pos/ui/button';
import { Card, CardHeader, CardTitle } from '@pos/ui/card';
import { ConfirmButton } from '@pos/ui/confirm';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@pos/ui/table';
import { GraduationCapIcon, LogInIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { formatDate, formatDateTime } from '@/components/backoffice/admin/format';
import { useServerAction } from '@/components/backoffice/use-server-action';
import { createTraining, openOrganization } from './actions';
import { SubscriptionDialog } from './subscription-dialog';

/** Organizations on the platform; one opens only with the owner's active grant (RF-A10). */
export function OrganizationList({
  organizations,
  currentId,
  catalog,
}: {
  organizations: admin.PlatformOrganizationDto[];
  currentId: string | null;
  catalog: { plans: { code: string; name: string }[]; addons: { code: string; name: string }[] };
}) {
  const t = useTranslations('supportConsole');
  const tp = useTranslations('supportConsole.plan');
  const tc = useTranslations('common');
  // On success the action redirects to the backoffice.
  const open = useServerAction(openOrganization, { successMessage: false });
  const training = useServerAction(createTraining, { successMessage: t('trainingCreated') });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('organizations')}</CardTitle>
      </CardHeader>
      {organizations.length === 0 ? (
        <p className="text-muted-foreground">{t('empty')}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('name')}</TableHead>
              <TableHead>{t('createdAt')}</TableHead>
              <TableHead className="text-right">{t('locations')}</TableHead>
              <TableHead>{tp('plan')}</TableHead>
              <TableHead>{t('access')}</TableHead>
              <TableHead className="text-right">
                <span className="sr-only">{t('open')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {organizations.map((org) => {
              const hasGrant = org.supportGrantExpiresAt !== null;
              const reason = !hasGrant
                ? t('noGrant')
                : !org.primaryLocationId
                  ? t('noLocation')
                  : undefined;
              return (
                <TableRow key={org.id} aria-current={org.id === currentId ? 'true' : undefined}>
                  <TableCell>
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      {org.name}
                      {org.isTraining ? <Badge variant="secondary">{t('training')}</Badge> : null}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {org.legalName ? `${org.legalName} · ` : ''}
                      <span className="font-mono">{org.slug}</span>
                    </span>
                  </TableCell>
                  <TableCell className="tabular-nums">{formatDate(org.createdAt)}</TableCell>
                  <TableCell className="text-right tabular-nums">{org.locationsCount}</TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1">
                      <span data-testid="org-plan">{org.plan?.name ?? 'Pro'}</span>
                      {org.plan && org.plan.status !== 'active' ? (
                        <Badge
                          variant={org.plan.status === 'suspended' ? 'destructive' : 'warning'}
                        >
                          {tp(`statuses.${org.plan.status as 'active'}`)}
                        </Badge>
                      ) : null}
                      <SubscriptionDialog
                        organization={{ id: org.id, name: org.name }}
                        catalog={catalog}
                      />
                      {org.isTraining ? null : (
                        <ConfirmButton
                          variant="ghost"
                          size="icon"
                          aria-label={t('createTraining', { name: org.name })}
                          title={t('createTraining', { name: org.name })}
                          disabled={training.pending}
                          confirmLabel={t('createTrainingConfirm')}
                          cancelLabel={tc('cancel')}
                          description={t('createTrainingText')}
                          onConfirm={() => training.run(org.id)}
                        >
                          <GraduationCapIcon />
                        </ConfirmButton>
                      )}
                    </span>
                  </TableCell>
                  <TableCell>
                    {org.supportGrantExpiresAt ? (
                      <Badge variant="success">{formatDateTime(org.supportGrantExpiresAt)}</Badge>
                    ) : (
                      <span className="text-muted-foreground">{t('noAccess')}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant={hasGrant ? 'default' : 'outline'}
                      disabled={!!reason || open.pending}
                      title={reason}
                      onClick={() => void open.run(org.id)}
                    >
                      <LogInIcon /> {t('open')}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
