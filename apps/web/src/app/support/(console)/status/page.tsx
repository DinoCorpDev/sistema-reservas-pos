import { admin } from '@pos/api';
import { Alert } from '@pos/ui/alert';
import { Badge } from '@pos/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@pos/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@pos/ui/table';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { auth } from '@/auth';
import { AutoRefresh } from '@/components/auto-refresh';
import { PageHeader } from '@/components/backoffice/page-header';
import { deps } from '@/server/actor';

export const metadata: Metadata = { title: 'Status' };

/** A device or hub seen within these minutes counts as online on this page. */
const ONLINE_MS = 5 * 60_000;

/**
 * Platform status for DINOLABS support (RNF-16): the open alerts of the monitor, the backups and
 * the archive, and per location its hubs, devices with their app version, printers and sync
 * conflicts. Refreshes itself every 30 seconds.
 */
export default async function PlatformStatusPage() {
  const session = await auth();
  if (session?.user?.kind !== 'support' || !session.user.id) redirect('/support/login');
  const t = await getTranslations('supportConsole.status');
  const format = await getFormatter();
  const status = await admin.platformStatus(deps(), { staffId: session.user.id });
  const now = Date.parse(status.checkedAt);
  const when = (iso: string | null) =>
    iso ? format.relativeTime(new Date(iso), new Date(now)) : t('never');
  const online = (iso: string | null) => iso !== null && now - Date.parse(iso) < ONLINE_MS;
  const job = (summary: (typeof status.jobs)['backup']) =>
    summary.last && !summary.last.ok
      ? { ok: false, text: `${t('failed')} · ${when(summary.last.at)}` }
      : {
          ok: summary.lastOkAt !== null,
          text: summary.lastOkAt ? when(summary.lastOkAt) : t('never'),
        };
  const jobs = [
    { key: 'backup', ...job(status.jobs.backup) },
    { key: 'restoreTest', ...job(status.jobs.restoreTest) },
    { key: 'archive', ...job(status.jobs.archive) },
  ] as const;

  return (
    <>
      <AutoRefresh />
      <PageHeader
        title={t('title')}
        description={t('refreshed', {
          time: format.dateTime(new Date(status.checkedAt), { timeStyle: 'medium' }),
        })}
      />
      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('alerts')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {status.alerts.length === 0 ? (
              <Alert variant="success" data-testid="status-no-alerts">
                {t('noAlerts')}
              </Alert>
            ) : (
              status.alerts.map((alert) => (
                <div
                  key={alert.key}
                  className="flex flex-wrap items-start gap-3 rounded-lg border p-3"
                  data-testid="status-alert"
                >
                  <Badge variant={alert.severity === 'critical' ? 'destructive' : 'warning'}>
                    {t.has(`kinds.${alert.kind}`) ? t(`kinds.${alert.kind}`) : alert.kind}
                  </Badge>
                  <div className="grid min-w-0 flex-1 gap-0.5">
                    <span className="font-medium">{alert.subject}</span>
                    <span className="text-sm text-muted-foreground">{alert.detail}</span>
                  </div>
                  <span className="text-sm whitespace-nowrap text-muted-foreground">
                    {t('since', { time: when(alert.since) })}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {jobs.map((entry) => (
            <Card key={entry.key}>
              <CardContent className="grid gap-1 pt-6">
                <p className="text-sm text-muted-foreground">{t(`jobs.${entry.key}`)}</p>
                <p className={`font-semibold ${entry.ok ? '' : 'text-destructive'}`}>
                  {entry.text}
                </p>
              </CardContent>
            </Card>
          ))}
          <Card>
            <CardContent className="grid gap-1 pt-6">
              <p className="text-sm text-muted-foreground">{t('outbox')}</p>
              <p className="font-semibold">
                {t('pending', { count: status.outbox.pending })}
                {status.outbox.oldestAt ? ` · ${when(status.outbox.oldestAt)}` : ''}
              </p>
            </CardContent>
          </Card>
        </div>

        {status.locations.map((location) => (
          <Card key={location.locationId} data-testid="status-location">
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                {location.organizationName} · {location.locationName}
                {location.isTraining ? <Badge variant="secondary">{t('training')}</Badge> : null}
                {location.unresolvedConflicts > 0 ? (
                  <Badge variant="warning">
                    {t('conflicts', { count: location.unresolvedConflicts })}
                  </Badge>
                ) : null}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 lg:grid-cols-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('devices')}</TableHead>
                    <TableHead>{t('version')}</TableHead>
                    <TableHead className="text-right">{t('lastSeen')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {location.devices.map((device) => (
                    <TableRow key={device.terminalId}>
                      <TableCell>
                        <span
                          className={`mr-2 inline-block size-2 rounded-full ${online(device.lastSeenAt) ? 'bg-green-600' : 'bg-muted-foreground/40'}`}
                          aria-hidden
                        />
                        {device.name}
                        {location.hubs.some((hub) => hub.terminalId === device.terminalId)
                          ? ` (${t('hub')})`
                          : ''}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {device.appVersion ?? '—'}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {when(device.lastSeenAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('printers')}</TableHead>
                    <TableHead className="text-right">{t('state')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {location.printers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={2} className="text-muted-foreground">
                        {t('noPrinters')}
                      </TableCell>
                    </TableRow>
                  ) : (
                    location.printers.map((printer) => {
                      const failing =
                        printer.lastErrorAt !== null &&
                        (printer.lastOkAt === null ||
                          Date.parse(printer.lastErrorAt) > Date.parse(printer.lastOkAt));
                      return (
                        <TableRow key={printer.printerId}>
                          <TableCell>{printer.name}</TableCell>
                          <TableCell className="text-right">
                            {failing ? (
                              <Badge variant="destructive">{printer.lastError ?? t('error')}</Badge>
                            ) : (
                              <Badge variant="success">
                                {t('printed', { time: when(printer.lastOkAt) })}
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
