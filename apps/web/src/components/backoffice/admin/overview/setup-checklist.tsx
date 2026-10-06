'use client';

import type { admin } from '@pos/api';
import { Alert } from '@pos/ui/alert';
import { Badge } from '@pos/ui/badge';
import { Button } from '@pos/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@pos/ui/card';
import { ChevronRightIcon, CircleAlertIcon, CircleCheckIcon, ShieldCheckIcon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useServerAction } from '@/components/backoffice/use-server-action';
import { formatDate } from '../format';
import { activateOperation } from './actions';

/** Where each missing item is fixed. */
const FIX_PAGE: Record<string, string> = {
  location_details: '/backoffice/location',
  vat_uid: '/backoffice/location',
  languages: '/backoffice/location',
  areas: '/backoffice/floor',
  tables: '/backoffice/floor',
  pos_terminal: '/backoffice/devices',
  kitchen_station: '/backoffice/devices',
  receipt_printer: '/backoffice/devices',
  manager_with_pin: '/backoffice/users',
  tax_rules: '/backoffice/tax',
  products: '/backoffice/catalog',
  product_routing: '/backoffice/catalog',
  product_publication: '/backoffice/catalog',
  product_translations: '/backoffice/catalog',
};

/** Setup checklist of the location and the switch to real operation (RF-A11, Flujo 7). */
export function SetupChecklist({
  checklist,
  canActivate,
}: {
  checklist: admin.SetupChecklistDto;
  canActivate: boolean;
}) {
  const t = useTranslations('checklist');
  const to = useTranslations('overview');
  const activate = useServerAction(activateOperation, { successMessage: t('activatedToast') });
  const percent = checklist.total === 0 ? 0 : Math.round((checklist.done / checklist.total) * 100);

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{t('title')}</CardTitle>
          <span className="text-sm font-medium tabular-nums">
            {t('progress', { done: checklist.done, total: checklist.total })}
          </span>
        </div>
        <CardDescription>{t('subtitle')}</CardDescription>
        <div
          role="progressbar"
          aria-label={to('progressLabel')}
          aria-valuemin={0}
          aria-valuemax={checklist.total}
          aria-valuenow={checklist.done}
          className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
        >
          <div
            className={checklist.complete ? 'h-full bg-success' : 'h-full bg-primary'}
            style={{ width: `${percent}%` }}
          />
        </div>
      </CardHeader>

      <CardContent>
        <ul className="grid gap-2">
          {checklist.checks.map((check) => (
            <li
              key={check.key}
              className="flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2"
            >
              {check.done ? (
                <CircleCheckIcon className="size-6 shrink-0 text-success" aria-hidden />
              ) : (
                <CircleAlertIcon className="size-6 shrink-0 text-warning" aria-hidden />
              )}
              <span className="sr-only">{check.done ? to('checkDone') : to('checkOpen')}</span>
              <span className={check.done ? 'min-w-0 flex-1 text-muted-foreground' : 'min-w-0 flex-1'}>
                {t(`items.${check.key}`)}
              </span>
              {!check.done && check.missing ? (
                <Badge variant="warning">{t('missing', { count: check.missing })}</Badge>
              ) : null}
              <Button asChild variant={check.done ? 'ghost' : 'outline'}>
                <Link href={FIX_PAGE[check.key] ?? '/backoffice'}>
                  {t('goTo')}
                  <ChevronRightIcon />
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>

      <CardFooter className="justify-between">
        {checklist.operationActivatedAt ? (
          <Alert variant="success" className="flex items-center gap-2">
            <p className="flex items-center gap-2 font-medium">
              <ShieldCheckIcon className="size-5 text-success" aria-hidden />
              {t('activated', { date: formatDate(checklist.operationActivatedAt) })}
            </p>
          </Alert>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {!canActivate
                ? to('activateNoPermission')
                : checklist.complete
                  ? t('complete')
                  : to('activateHint')}
            </p>
            {canActivate ? (
              <Button
                size="lg"
                disabled={!checklist.complete || activate.pending}
                onClick={() => void activate.run()}
              >
                {t('activate')}
              </Button>
            ) : null}
          </>
        )}
      </CardFooter>
    </Card>
  );
}
