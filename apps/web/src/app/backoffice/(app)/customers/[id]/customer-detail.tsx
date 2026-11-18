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
import { ConfirmButton } from '@pos/ui/confirm';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@pos/ui/dialog';
import { Input } from '@pos/ui/input';
import { Field } from '@pos/ui/label';
import { toast } from '@pos/ui/toaster';
import { DownloadIcon, PlusIcon, UserXIcon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { formatDate, formatDateTime } from '@/components/backoffice/admin/format';
import { useServerAction } from '@/components/backoffice/use-server-action';
import * as actions from '../actions';
import {
  ConsentFields,
  type ConsentFormValues,
  consentPayload,
  useConsentDefaults,
} from '../consent-fields';
import { CustomerFields, customerFormOf, customerPayload, hasContact } from '../customer-fields';

/** Saves the export as a JSON file in the browser (RF-E16). */
function downloadJson(data: unknown, fileName: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function CustomerDetail({
  customer,
  canAnonymize,
}: {
  customer: admin.CustomerDetailDto;
  canAnonymize: boolean;
}) {
  const t = useTranslations('customers');
  const tc = useTranslations('common');
  const anonymized = customer.anonymizedAt !== null;
  const consentDefaults = useConsentDefaults();

  const [values, setValues] = useState(() => customerFormOf(customer));
  const [contactMissing, setContactMissing] = useState(false);
  const [existingId, setExistingId] = useState<string | null>(null);
  const [consentDraft, setConsentDraft] = useState<ConsentFormValues | null>(null);
  const [reason, setReason] = useState('');

  const update = useServerAction(actions.updateCustomer, {
    successMessage: false,
    onSuccess: (data) => {
      setExistingId(data.existingCustomerId);
      if (!data.existingCustomerId) toast.success(tc('saved'));
    },
  });
  const consent = useServerAction(actions.recordConsent, {
    successMessage: t('consentRecorded'),
    onSuccess: () => setConsentDraft(null),
  });
  const exportData = useServerAction(actions.exportCustomer, {
    successMessage: t('exported'),
    onSuccess: (data) => downloadJson(data, `gast-${customer.id}.json`),
  });
  const anonymize = useServerAction(actions.anonymizeCustomer, {
    successMessage: t('anonymized'),
  });

  const save = (event: FormEvent) => {
    event.preventDefault();
    const missing = !hasContact(values);
    setContactMissing(missing);
    setExistingId(null);
    if (!missing) void update.run(customer.id, customerPayload(values));
  };

  const submitConsent = (event: FormEvent) => {
    event.preventDefault();
    if (consentDraft?.given) void consent.run(customer.id, consentPayload(consentDraft));
  };

  return (
    <div className="grid gap-6">
      {anonymized ? (
        <Alert variant="warning">
          {t('anonymizedNotice', { date: formatDate(customer.anonymizedAt!) })}
        </Alert>
      ) : null}

      <Card>
        <form className="grid gap-4" onSubmit={save}>
          <CardHeader>
            <CardTitle>{t('details')}</CardTitle>
          </CardHeader>
          <CardContent>
            <CustomerFields
              idPrefix="customer"
              values={values}
              onChange={(next) => {
                setValues(next);
                if (contactMissing && hasContact(next)) setContactMissing(false);
              }}
              errors={update.fieldErrors}
              contactMissing={contactMissing}
              disabled={anonymized}
            />
            {existingId ? (
              <Alert
                variant="warning"
                className="flex flex-wrap items-center justify-between gap-3"
              >
                <span>{t('duplicate')}</span>
                <Button asChild variant="outline">
                  <Link href={`/backoffice/customers/${existingId}`}>{t('openExisting')}</Link>
                </Button>
              </Alert>
            ) : null}
          </CardContent>
          {anonymized ? null : (
            <CardFooter>
              <Button type="submit" disabled={update.pending}>
                {update.pending ? tc('saving') : tc('save')}
              </Button>
            </CardFooter>
          )}
        </form>
      </Card>

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>{t('consents')}</CardTitle>
          {anonymized ? null : (
            <Button variant="outline" onClick={() => setConsentDraft(consentDefaults.initial())}>
              <PlusIcon /> {t('recordConsent')}
            </Button>
          )}
        </CardHeader>
        {customer.consents.length === 0 ? (
          <p className="text-muted-foreground">{t('noConsents')}</p>
        ) : (
          <ul className="grid gap-3">
            {customer.consents.map((item) => (
              <li key={item.id} className="grid gap-2 rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {t.has(`purposes.${item.purpose}`)
                      ? t(`purposes.${item.purpose}`)
                      : item.purpose}
                  </span>
                  {item.revokedAt ? (
                    <Badge variant="outline">
                      {t('revokedOn', { date: formatDate(item.revokedAt) })}
                    </Badge>
                  ) : (
                    <Badge variant="success">{t('valid')}</Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {t('grantedAt')} {formatDateTime(item.grantedAt)} · {t('source')}{' '}
                  {t.has(`sources.${item.source}`) ? t(`sources.${item.source}`) : item.source} ·{' '}
                  {t('consentVersion')} {item.textVersion}
                </p>
                <details className="text-sm">
                  <summary className="flex min-h-11 cursor-pointer items-center font-medium text-brand-strong">
                    {t('showText')}
                  </summary>
                  <p className="rounded-md bg-muted p-3 whitespace-pre-wrap">{item.textSnapshot}</p>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {anonymized ? null : (
        <Card>
          <CardHeader>
            <CardTitle>{t('privacy')}</CardTitle>
            <CardDescription>{t('privacyHint')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div>
              <Button
                variant="outline"
                disabled={exportData.pending}
                onClick={() => void exportData.run(customer.id)}
              >
                <DownloadIcon /> {t('export')}
              </Button>
            </div>
            {canAnonymize ? (
              <div className="grid gap-3 rounded-lg border border-destructive/40 p-4">
                <Field
                  label={`${t('anonymizeReason')} (${tc('optional')})`}
                  htmlFor="anonymize-reason"
                  hint={t('anonymizeReasonHint')}
                  error={anonymize.fieldErrors.reason}
                >
                  <Input
                    id="anonymize-reason"
                    maxLength={500}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </Field>
                <div className="flex flex-wrap items-center gap-3">
                  <ConfirmButton
                    variant="destructive"
                    disabled={anonymize.pending}
                    title={t('anonymizeTitle')}
                    description={t('anonymizeText')}
                    confirmLabel={t('anonymize')}
                    cancelLabel={tc('cancel')}
                    onConfirm={() => anonymize.run(customer.id, { reason: reason.trim() || null })}
                  >
                    <UserXIcon /> {t('anonymize')}
                  </ConfirmButton>
                  <p className="text-sm text-muted-foreground">{t('anonymizeWarning')}</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t('anonymizeNoPermission')}</p>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={!!consentDraft} onOpenChange={(open) => !open && setConsentDraft(null)}>
        <DialogContent closeLabel={tc('close')} className="sm:max-w-2xl">
          {consentDraft ? (
            <form className="grid gap-4" onSubmit={submitConsent}>
              <DialogHeader>
                <DialogTitle>{t('recordConsent')}</DialogTitle>
                <DialogDescription>{t('consentTextHint')}</DialogDescription>
              </DialogHeader>
              <ConsentFields
                idPrefix="record-consent"
                values={consentDraft}
                onChange={setConsentDraft}
                errors={consent.fieldErrors}
                choosePurpose
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setConsentDraft(null)}>
                  {tc('cancel')}
                </Button>
                <Button type="submit" disabled={consent.pending || !consentDraft.given}>
                  {consent.pending ? tc('saving') : tc('save')}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
