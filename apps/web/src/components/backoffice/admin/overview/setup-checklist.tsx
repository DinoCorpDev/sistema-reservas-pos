'use client';

import type { admin } from '@pos/api';
import { Alert } from '@pos/ui/alert';
import { Badge } from '@pos/ui/badge';
import { Button } from '@pos/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@pos/ui/card';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  ListChecksIcon,
  ShieldCheckIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
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
  station_output: '/backoffice/devices?tab=stations',
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
  // A finished checklist folds away; it opens on demand. Pending items come first.
  const [expanded, setExpanded] = useState(!checklist.complete);
  const checks = [...checklist.checks].sort((a, b) => Number(a.done) - Number(b.done));

  return (
    <Card className={checklist.complete ? 'border-success/30' : undefined}>
      <CardHeader
        icon={checklist.complete ? <ShieldCheckIcon /> : <ListChecksIcon />}
        iconTone={checklist.complete ? 'success' : 'brand'}
        action={
          <div className="flex items-center gap-3">
            <ProgressRing
              value={checklist.done}
              total={checklist.total}
              percent={percent}
              complete={checklist.complete}
              label={to('progressLabel')}
            />
          </div>
        }
      >
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('subtitle')}</CardDescription>
        <span className="text-sm font-medium tabular-nums">
          {t('progress', { done: checklist.done, total: checklist.total })}
        </span>
      </CardHeader>

      {checklist.complete ? (
        <Button
          variant="ghost"
          className="self-start text-sm text-muted-foreground"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
        >
          <ChevronDownIcon
            className={expanded ? 'rotate-180 transition-transform' : 'transition-transform'}
          />
          {expanded ? t('hideList') : t('showList')}
        </Button>
      ) : null}

      {expanded ? (
        <CardContent>
          <ul className="grid gap-2">
            {checks.map((check) => (
              <li
                key={check.key}
                className={
                  check.done
                    ? 'flex flex-wrap items-center gap-3 rounded-lg px-3 py-1.5'
                    : 'flex flex-wrap items-center gap-3 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2'
                }
              >
                {check.done ? (
                  <CircleCheckIcon className="size-5 shrink-0 text-success" aria-hidden />
                ) : (
                  <CircleAlertIcon className="size-5 shrink-0 text-amber-600" aria-hidden />
                )}
                <span className="sr-only">{check.done ? to('checkDone') : to('checkOpen')}</span>
                <span
                  className={
                    check.done
                      ? 'min-w-0 flex-1 text-sm text-muted-foreground'
                      : 'min-w-0 flex-1 font-medium'
                  }
                >
                  {t(`items.${check.key}`)}
                </span>
                {!check.done && check.missing ? (
                  <Badge variant="warning">{t('missing', { count: check.missing })}</Badge>
                ) : null}
                <Button
                  asChild
                  variant={check.done ? 'ghost' : 'outline'}
                  className={check.done ? 'text-muted-foreground' : undefined}
                >
                  <Link href={FIX_PAGE[check.key] ?? '/backoffice'}>
                    {t('goTo')}
                    <ChevronRightIcon />
                  </Link>
                </Button>
              </li>
            ))}
          </ul>
        </CardContent>
      ) : null}

      <CardFooter className="justify-between">
        {checklist.operationActivatedAt ? (
          <Alert icon={false} variant="success" className="flex items-center gap-2">
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

/** The setup progress as a ring: teal while open, green when everything is done. */
function ProgressRing({
  value,
  total,
  percent,
  complete,
  label,
}: {
  value: number;
  total: number;
  percent: number;
  complete: boolean;
  label: string;
}) {
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={value}
      className="relative grid size-12 place-items-center"
    >
      <svg viewBox="0 0 44 44" className="size-12 -rotate-90" aria-hidden>
        <circle cx="22" cy="22" r={radius} fill="none" strokeWidth="4" className="stroke-muted" />
        <circle
          cx="22"
          cy="22"
          r={radius}
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - percent / 100)}
          className={complete ? 'stroke-success' : 'stroke-brand'}
        />
      </svg>
      <span className="absolute text-[11px] font-semibold tabular-nums">{percent}%</span>
    </div>
  );
}
