'use client';

import type { admin } from '@pos/api';
import { Alert } from '@pos/ui/alert';
import { Button } from '@pos/ui/button';
import { Card } from '@pos/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@pos/ui/dialog';
import { Input } from '@pos/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@pos/ui/table';
import { toast } from '@pos/ui/toaster';
import { ChevronRightIcon, PlusIcon, SearchIcon, XIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState, useTransition } from 'react';
import { customerName, formatDate, formatPhone } from '@/components/backoffice/admin/format';
import { useServerAction } from '@/components/backoffice/use-server-action';
import * as actions from './actions';
import {
  ConsentFields,
  type ConsentFormValues,
  consentPayload,
  useConsentDefaults,
} from './consent-fields';
import {
  CustomerFields,
  type CustomerFormValues,
  customerPayload,
  emptyCustomerForm,
  hasContact,
} from './customer-fields';

export function CustomerList({
  customers,
  search,
  limit,
}: {
  customers: admin.CustomerDto[];
  search: string;
  limit: number;
}) {
  const t = useTranslations('customers');
  const tc = useTranslations('common');
  const tl = useTranslations('languages');
  const router = useRouter();
  const [query, setQuery] = useState(search);
  const [searching, startSearch] = useTransition();
  const [creating, setCreating] = useState(false);

  const go = (value: string) =>
    startSearch(() =>
      router.push(
        value.trim()
          ? `/backoffice/customers?q=${encodeURIComponent(value.trim())}`
          : '/backoffice/customers',
      ),
    );

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <form
          role="search"
          className="flex w-full max-w-xl gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            go(query);
          }}
        >
          <div className="relative flex-1">
            <SearchIcon
              className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              aria-label={t('searchLabel')}
              placeholder={t('searchPlaceholder')}
              className="pl-10"
              maxLength={100}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <Button type="submit" variant="outline" disabled={searching}>
            {tc('search')}
          </Button>
          {search ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('clearSearch')}
              disabled={searching}
              onClick={() => {
                setQuery('');
                go('');
              }}
            >
              <XIcon />
            </Button>
          ) : null}
        </form>
        <Button onClick={() => setCreating(true)}>
          <PlusIcon /> {t('newCustomer')}
        </Button>
      </div>

      {customers.length === 0 ? (
        <Card>
          <p className="text-muted-foreground">{search ? t('noResults') : t('empty')}</p>
        </Card>
      ) : (
        <Table className="[&_td]:py-1.5">
          <TableHeader>
            <TableRow>
              <TableHead>{t('name')}</TableHead>
              <TableHead>{t('phone')}</TableHead>
              <TableHead>{t('email')}</TableHead>
              <TableHead>{t('language')}</TableHead>
              <TableHead>{t('createdAt')}</TableHead>
              <TableHead className="text-right">
                <span className="sr-only">{tc('actions')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {customers.map((customer) => (
              <TableRow key={customer.id}>
                <TableCell className="font-medium">
                  <Link
                    href={`/backoffice/customers/${customer.id}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {customerName(customer, t('noName'))}
                  </Link>
                  {customer.tags.length > 0 ? (
                    <span className="block text-xs text-muted-foreground">
                      {customer.tags.join(', ')}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">
                  {formatPhone(customer.phone) || '—'}
                </TableCell>
                <TableCell>{customer.email ?? '—'}</TableCell>
                <TableCell>{customer.language ? tl(customer.language) : '—'}</TableCell>
                <TableCell className="tabular-nums">{formatDate(customer.createdAt)}</TableCell>
                <TableCell className="text-right">
                  <Button asChild variant="ghost" size="icon" aria-label={t('open')}>
                    <Link href={`/backoffice/customers/${customer.id}`}>
                      <ChevronRightIcon />
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {customers.length >= limit ? (
        <p className="text-sm text-muted-foreground">{t('resultsLimited', { count: limit })}</p>
      ) : null}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent closeLabel={tc('close')} className="sm:max-w-2xl">
          {creating ? <NewCustomerForm onCancel={() => setCreating(false)} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** New guest: contact data plus the mandatory consent (RN-23); duplicates link to the guest. */
function NewCustomerForm({ onCancel }: { onCancel: () => void }) {
  const t = useTranslations('customers');
  const tc = useTranslations('common');
  const router = useRouter();
  const consentDefaults = useConsentDefaults();
  const [values, setValues] = useState<CustomerFormValues>(emptyCustomerForm);
  const [consent, setConsent] = useState<ConsentFormValues>(() => consentDefaults.initial());
  const [contactMissing, setContactMissing] = useState(false);
  const [existingId, setExistingId] = useState<string | null>(null);

  const create = useServerAction(actions.createCustomer, {
    successMessage: false,
    onSuccess: (data) => {
      setExistingId(data.existingCustomerId);
      if (data.customerId) {
        toast.success(t('created'));
        router.push(`/backoffice/customers/${data.customerId}`);
      }
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const missing = !hasContact(values);
    setContactMissing(missing);
    setExistingId(null);
    if (missing || !consent.given) return;
    void create.run({ ...customerPayload(values), consent: consentPayload(consent) });
  };

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>{t('newCustomer')}</DialogTitle>
        <DialogDescription>{t('contactHint')}</DialogDescription>
      </DialogHeader>
      <CustomerFields
        idPrefix="new-customer"
        values={values}
        onChange={(next) => {
          setValues(next);
          if (contactMissing && hasContact(next)) setContactMissing(false);
        }}
        errors={create.fieldErrors}
        contactMissing={contactMissing}
      />
      <ConsentFields
        idPrefix="new-consent"
        values={consent}
        onChange={setConsent}
        errors={create.fieldErrors}
        errorPrefix="consent."
      />
      {existingId ? (
        <Alert variant="warning" className="flex flex-wrap items-center justify-between gap-3">
          <span>{t('duplicate')}</span>
          <Button asChild variant="outline">
            <Link href={`/backoffice/customers/${existingId}`}>{t('openExisting')}</Link>
          </Button>
        </Alert>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {tc('cancel')}
        </Button>
        <Button type="submit" disabled={create.pending || !consent.given}>
          {create.pending ? tc('saving') : tc('save')}
        </Button>
      </DialogFooter>
    </form>
  );
}
