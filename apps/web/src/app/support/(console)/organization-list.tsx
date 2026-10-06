'use client';

import type { admin } from '@pos/api';
import { Badge } from '@pos/ui/badge';
import { Button } from '@pos/ui/button';
import { Card, CardHeader, CardTitle } from '@pos/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@pos/ui/table';
import { LogInIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { formatDate, formatDateTime } from '@/components/backoffice/admin/format';
import { useServerAction } from '@/components/backoffice/use-server-action';
import { openOrganization } from './actions';

/** Organizations on the platform; one opens only with the owner's active grant (RF-A10). */
export function OrganizationList({
  organizations,
  currentId,
}: {
  organizations: admin.PlatformOrganizationDto[];
  currentId: string | null;
}) {
  const t = useTranslations('supportConsole');
  // On success the action redirects to the backoffice.
  const open = useServerAction(openOrganization, { successMessage: false });

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
