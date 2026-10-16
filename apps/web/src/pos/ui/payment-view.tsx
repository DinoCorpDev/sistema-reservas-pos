'use client';

import {
  type ContentLanguage,
  isContentLanguage,
  MoneyError,
  type OrderState,
  PaymentRuleError,
  paymentsOf,
  rappen,
  ReceiptError,
} from '@pos/core';
import { formatPosMoney, roundPosCash } from '@/pos/money';
import { Badge } from '@pos/ui/badge';
import { Button } from '@pos/ui/button';
import { Input, Textarea } from '@pos/ui/input';
import { Label } from '@pos/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@pos/ui/select';
import { cn } from '@pos/ui/utils';
import { ArrowLeft, Banknote, CreditCard, Eraser, Smartphone } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import {
  cashOwner,
  currentShift,
  NoCashHereError,
  NoShiftError,
  pay,
  type PaymentInput,
} from '../actions';
import { useFoldMemo } from './order/hooks';
import { usePos } from '@/device/store';
import { usePosUi } from '../ui-store';
import { NumPad } from '@/device/ui/num-pad';
import { AmountField } from './payment/amount-field';
import { ClosedOrderPanel } from './payment/closed-order-panel';
import { useFold, useKeypadVisible } from './payment/hooks';
import {
  equalSplitOf,
  eraseAmountKey,
  nextToCollect,
  parseAmount,
  quickTenders,
  receiptLanguages,
  splitInProgress,
  toAmountText,
  typeAmountKey,
} from './payment/model';
import { OrderSummary } from './payment/order-summary';
import { SplitControls } from './payment/split-controls';

/**
 * Collecting an order (RF-D02, RF-D03, RF-D04, RF-D06, RF-D22, RF-D23, RF-C12, RF-C17): partial
 * and mixed payments, cash with the CHF 0.05 rounding and change, card/TWINT on the independent
 * terminal, tips outside the sale, the customer on the receipt and its language. Each payment
 * issues its own receipt (RN-09). Works the same before the kitchen got the order (prepay).
 */
export function PaymentView({ orderId }: { orderId: string }) {
  // Another order (e.g. the part split off) starts with a fresh form.
  return <PaymentScreen key={orderId} orderId={orderId} />;
}

function PaymentScreen({ orderId }: { orderId: string }) {
  const t = useTranslations('posPayment.screen');
  const tc = useTranslations('posPayment.channels');
  const navigate = usePosUi((state) => state.navigate);
  const tables = usePos((state) => state.bootstrap?.tables);
  const fold = useFold();
  const order = fold.orders.get(orderId);

  if (!order) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-muted-foreground">{t('notFound')}</p>
        <Button variant="outline" onClick={() => navigate({ name: 'orders' })}>
          {t('toOrders')}
        </Button>
      </div>
    );
  }

  const table = order.tableId ? tables?.find((candidate) => candidate.id === order.tableId) : null;
  const parent = order.splitFromOrderId ? fold.orders.get(order.splitFromOrderId) : undefined;
  const payable = order.status === 'open' && order.balanceRappen > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b bg-card px-3 py-2">
        <Button variant="ghost" onClick={() => navigate({ name: 'order', orderId })}>
          <ArrowLeft /> {t('backToOrder')}
        </Button>
        <h1 className="text-lg font-semibold">{t('title', { number: order.displayNumber })}</h1>
        <Badge variant="secondary">
          {table ? t('table', { label: table.label }) : tc(order.channel)}
        </Badge>
        {parent && (
          <Button
            variant="outline"
            className="ml-auto"
            onClick={() => navigate({ name: 'payment', orderId: parent.id })}
          >
            {t('toParent', { number: parent.displayNumber })}
          </Button>
        )}
      </div>
      <div className="grid flex-1 content-start items-start gap-3 p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)_17rem]">
        <OrderSummary order={order} fold={fold} />
        {payable ? <PaymentForm order={order} /> : <SettledPanel order={order} />}
      </div>
    </div>
  );
}

/** Nothing left to collect here: paid, closed or voided. */
function SettledPanel({ order }: { order: OrderState }) {
  const t = useTranslations('posPayment.screen');
  const tr = useTranslations('posPayment.receipt');
  const navigate = usePosUi((state) => state.navigate);
  const goBack = usePosUi((state) => state.goBack);
  const fold = useFold();
  const next = nextToCollect(fold, order.id);
  const message =
    order.status === 'voided'
      ? t('voided')
      : order.status === 'closed'
        ? t('closed')
        : t('settled');
  return (
    <div className="grid content-start gap-3 md:col-span-1 lg:col-span-2">
      <div className="grid gap-3 rounded-xl border bg-card p-4">
        <p className="font-medium" aria-live="polite">
          {message}
        </p>
        <div className="flex flex-wrap gap-2">
          {next && (
            <Button size="lg" onClick={() => navigate({ name: 'payment', orderId: next })}>
              {tr('continue')}
            </Button>
          )}
          <Button size="lg" variant="outline" onClick={goBack}>
            {tr('done')}
          </Button>
        </div>
      </div>
      {order.status !== 'voided' && <ClosedOrderPanel orderId={order.id} />}
    </div>
  );
}

type Method = 'cash' | 'card' | 'twint';
type FieldKey = 'amount' | 'tendered' | 'tip' | 'approved';

const METHODS: readonly { method: Method; icon: typeof Banknote }[] = [
  { method: 'cash', icon: Banknote },
  { method: 'card', icon: CreditCard },
  { method: 'twint', icon: Smartphone },
];

function PaymentForm({ order }: { order: OrderState }) {
  const t = useTranslations('posPayment.form');
  const te = useTranslations('posPayment.errors');
  const tm = useTranslations('posPayment.methods');
  const tl = useTranslations('posPayment.languages');
  const navigate = usePosUi((state) => state.navigate);
  const location = usePos((state) => state.bootstrap?.location);
  const users = usePos((state) => state.bootstrap?.users);
  const fold = useFold();
  const keypadVisible = useKeypadVisible();
  // Cash goes into an open shift of this till or wallet (RN-19, DEC-038).
  const cashState = useFoldMemo(
    () => (cashOwner() ? (currentShift() ? 'open' : 'no_shift') : 'none'),
    [],
  );
  const methods = METHODS.filter(({ method: key }) => key !== 'cash' || cashState !== 'none');
  const tcash = useTranslations('posCash.payment');
  const nameRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);

  const languages = receiptLanguages(location);
  const threshold = rappen(location?.settings.receipts.customerNameFromRappen ?? 40_000);
  const waiter = users?.find((user) => user.id === order.waiterUserId)?.displayName ?? null;
  const balance = order.balanceRappen;
  const payments = paymentsOf(fold, order.id);

  const [method, setMethod] = useState<Method | null>(null);
  /** null = the proposed amount (the balance, or the next equal part). */
  const [amountText, setAmountText] = useState<string | null>(null);
  const [tenderedText, setTenderedText] = useState('');
  const [tipText, setTipText] = useState('');
  /** null = the amount itself (no tip on the terminal). */
  const [approvedText, setApprovedText] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [language, setLanguage] = useState<ContentLanguage>(languages.initial);
  const [keypad, setKeypad] = useState<{ field: FieldKey; replace: boolean }>({
    field: 'amount',
    replace: true,
  });
  const [chosenParts, setChosenParts] = useState<number | null>(null);
  const [splitDismissed, setSplitDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Equal split (DEC-025): in progress from the labelled payments, or just chosen here.
  const parts = splitDismissed ? null : (chosenParts ?? splitInProgress(payments));
  const split = parts ? equalSplitOf(payments, balance, parts) : null;
  const part = split?.upcoming[0] ?? null;
  const proposed = part?.amountRappen ?? balance;

  const amount = amountText === null ? proposed : parseAmount(amountText);
  const tip = tipText.trim() === '' ? rappen(0) : parseAmount(tipText);
  const tendered = tenderedText.trim() === '' ? null : parseAmount(tenderedText);
  const tenderedInvalid = tenderedText.trim() !== '' && tendered === null;
  const approved = approvedText === null ? amount : parseAmount(approvedText);
  const amountOk = amount !== null && amount > 0 && amount <= balance;

  // Cash (RN-06): what is handed over (sale + tip) is rounded to CHF 0.05.
  const cash =
    method === 'cash' && amount !== null && amountOk && tip !== null
      ? roundPosCash(rappen(amount + tip))
      : null;
  const change = cash && tendered !== null ? tendered - cash.payable : null;
  // Terminal (RF-D04, RF-D06): an approved amount above the sale is the tip.
  const terminalTip =
    method !== null && method !== 'cash' && amount !== null && approved !== null
      ? approved - amount
      : null;
  const customerRequired = amount !== null && amount >= threshold;
  const collectNow =
    method === 'cash' ? (cash?.payable ?? null) : method === null ? amount : approved;

  const amountProblem =
    amountText === null
      ? null
      : amount === null || amount <= 0
        ? te('invalidAmount')
        : amount > balance
          ? te('aboveBalance', { balance: formatPosMoney(balance) })
          : null;

  const texts: Record<FieldKey, string> = {
    amount: amountText ?? toAmountText(proposed),
    tendered: tenderedText,
    tip: tipText,
    approved: approvedText ?? (amount !== null ? toAmountText(amount) : ''),
  };
  const fieldLabels: Record<FieldKey, string> = {
    amount: t('amount'),
    tendered: t('tendered'),
    tip: t('tip'),
    approved: t('approved'),
  };

  function setText(field: FieldKey, text: string) {
    setError(null);
    if (field === 'amount') setAmountText(text);
    else if (field === 'tendered') setTenderedText(text);
    else if (field === 'tip') setTipText(text);
    else setApprovedText(text);
  }

  const focusField = (field: FieldKey) => setKeypad({ field, replace: true });
  const typeInto = (field: FieldKey) => (text: string) => {
    setText(field, text);
    setKeypad({ field, replace: false });
  };

  function onKey(key: string) {
    setText(keypad.field, typeAmountKey(texts[keypad.field], key, keypad.replace));
    setKeypad({ field: keypad.field, replace: false });
  }

  function onBackspace() {
    setText(keypad.field, eraseAmountKey(texts[keypad.field], keypad.replace));
    setKeypad({ field: keypad.field, replace: false });
  }

  function onClearField() {
    setText(keypad.field, '');
    setKeypad({ field: keypad.field, replace: false });
  }

  function chooseMethod(next: Method) {
    setMethod(next);
    setError(null);
    // The next thing typed is what the guest hands over, or what the terminal approved.
    setKeypad({ field: next === 'cash' ? 'tendered' : 'approved', replace: true });
  }

  function applyEqualSplit(count: number) {
    setChosenParts(count);
    setSplitDismissed(false);
    setAmountText(null);
    setApprovedText(null);
    setError(null);
    setKeypad({ field: 'amount', replace: true });
  }

  function cancelSplit() {
    setChosenParts(null);
    setSplitDismissed(true);
    setAmountText(null);
    setApprovedText(null);
    setError(null);
  }

  /** The payment as the adapter receives it, or why it cannot be taken. */
  function prepare(): { error: string; field?: 'customer' } | { input: PaymentInput } {
    if (!method) return { error: te('chooseMethod') };
    if (amount === null || amount <= 0) return { error: te('invalidAmount') };
    if (amount > balance)
      return { error: te('aboveBalance', { balance: formatPosMoney(balance) }) };
    const name = customerName.trim();
    const address = customerAddress.trim();
    const common = {
      amountRappen: amount,
      splitLabel: split && part ? `${part.index}/${split.parts}` : null,
      language,
      customer: name === '' ? null : { name, address: address === '' ? null : address },
    };
    let input: PaymentInput;
    if (method === 'cash') {
      if (tip === null) return { error: te('invalidTip') };
      if (tenderedInvalid) return { error: te('invalidTendered') };
      const { payable } = roundPosCash(rappen(amount + tip));
      if (tendered !== null && tendered < payable) {
        return { error: te('insufficientTender', { amount: formatPosMoney(payable) }) };
      }
      input = {
        ...common,
        adapter: 'cash',
        method: 'cash',
        tipRappen: tip,
        tenderedRappen: tendered ?? undefined,
      };
    } else {
      if (approved === null) return { error: te('invalidApproved') };
      if (approved < amount) return { error: te('approvedBelowAmount') };
      input = { ...common, adapter: 'external-terminal', method, approvedRappen: approved };
    }
    if (name === '' && address !== '') {
      return { error: te('addressWithoutName'), field: 'customer' };
    }
    // RN-08 / DEC-009: from CHF 400 inclusive the receipt carries the customer's name.
    if (name === '' && amount >= threshold) {
      return {
        error: te('customerNameRequired', { threshold: formatPosMoney(threshold) }),
        field: 'customer',
      };
    }
    return { input };
  }

  function describe(caught: unknown): string {
    if (caught instanceof ReceiptError) {
      if (caught.code === 'CUSTOMER_NAME_REQUIRED') {
        return te('customerNameRequired', { threshold: formatPosMoney(threshold) });
      }
      return caught.code === 'VAT_UID_MISSING' ? te('vatUidMissing') : te('nothingToReceipt');
    }
    if (caught instanceof PaymentRuleError) {
      if (caught.code === 'INSUFFICIENT_TENDER') {
        return te('insufficientTender', { amount: formatPosMoney(cash?.payable ?? rappen(0)) });
      }
      // The balance may have changed meanwhile (a payment from another terminal).
      return amount !== null && amount > order.balanceRappen
        ? te('aboveBalance', { balance: formatPosMoney(order.balanceRappen) })
        : te('invalidAmount');
    }
    if (caught instanceof MoneyError) return te('invalidAmount');
    if (caught instanceof NoShiftError) return tcash('noShift');
    if (caught instanceof NoCashHereError) return tcash('noCashHere');
    return te('generic');
  }

  async function confirm() {
    if (busyRef.current) return;
    const prepared = prepare();
    if ('error' in prepared) {
      setError(prepared.error);
      if (prepared.field === 'customer') nameRef.current?.focus();
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const issued = await pay(order.id, prepared.input);
      navigate({
        name: 'receipt',
        orderId: order.id,
        content: issued.content,
        receiptId: issued.receiptId,
      });
    } catch (caught) {
      busyRef.current = false;
      setBusy(false);
      setError(describe(caught));
    }
  }

  const field = (key: FieldKey) => ({
    value: texts[key],
    active: keypad.field === key,
    keypad: keypadVisible,
    onFocus: () => focusField(key),
    onChange: typeInto(key),
  });

  return (
    <>
      <section
        aria-label={t('formTitle')}
        className="grid content-start gap-5 rounded-xl border bg-card p-4"
      >
        <SplitControls
          order={order}
          fold={fold}
          split={split}
          onEqualSplit={applyEqualSplit}
          onCancelSplit={cancelSplit}
        />

        <AmountField
          id="payment-amount"
          label={t('amount')}
          {...field('amount')}
          invalid={amountProblem !== null}
          hint={
            // While the alert shows the problem, the hint does not repeat it.
            (error === null ? amountProblem : null) ??
            (split && part
              ? t('partHint', { index: part.index, parts: split.parts })
              : t('balanceHint', { balance: formatPosMoney(balance) }))
          }
        />

        <div className="grid gap-2">
          <span id="payment-method-label" className="text-sm font-medium">
            {t('method')}
          </span>
          <div
            role="group"
            aria-labelledby="payment-method-label"
            className={cn('grid gap-2', methods.length === 3 ? 'grid-cols-3' : 'grid-cols-2')}
          >
            {methods.map(({ method: key, icon: Icon }) => (
              <Button
                key={key}
                type="button"
                size="lg"
                variant={method === key ? 'default' : 'outline'}
                aria-pressed={method === key}
                disabled={key === 'cash' && cashState === 'no_shift'}
                className="h-auto min-h-16 flex-col gap-1 px-2"
                onClick={() => chooseMethod(key)}
              >
                <Icon aria-hidden />
                {tm(key)}
              </Button>
            ))}
          </div>
          {cashState === 'no_shift' && (
            <p className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
              {tcash('noShift')}
              <Button type="button" variant="outline" onClick={() => navigate({ name: 'cash' })}>
                {tcash('openShift')}
              </Button>
            </p>
          )}
          {cashState === 'none' && (
            <p className="text-sm text-muted-foreground">{tcash('noCashHere')}</p>
          )}
        </div>

        {method === 'cash' && (
          <div className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <AmountField
                id="payment-tendered"
                label={t('tendered')}
                size="md"
                {...field('tendered')}
                invalid={tenderedInvalid || (change !== null && change < 0)}
              />
              <AmountField
                id="payment-tip"
                label={t('tip')}
                size="md"
                {...field('tip')}
                invalid={tip === null}
                hint={waiter ? t('tipHint', { name: waiter }) : t('tipHintNoName')}
              />
            </div>
            {cash && (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setTenderedText(toAmountText(cash.payable));
                    setError(null);
                  }}
                >
                  {t('exact')}
                </Button>
                {quickTenders(cash.payable).map((value) => (
                  <Button
                    key={value}
                    type="button"
                    variant="secondary"
                    className="tabular-nums"
                    onClick={() => {
                      setTenderedText(toAmountText(value));
                      setError(null);
                    }}
                  >
                    {formatPosMoney(value)}
                  </Button>
                ))}
              </div>
            )}
            <dl className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 gap-y-1 rounded-lg bg-muted px-3 py-2">
              <dt className="text-sm">{t('collect')}</dt>
              <dd className="text-right font-semibold tabular-nums" data-testid="payment-collect">
                {cash ? formatPosMoney(cash.payable) : '–'}
              </dd>
              {cash && cash.rounding !== 0 && (
                <>
                  <dt className="text-sm text-muted-foreground">{t('rounding')}</dt>
                  <dd
                    className="text-right text-sm text-muted-foreground tabular-nums"
                    data-testid="payment-rounding"
                  >
                    {cash.rounding > 0 ? '+' : ''}
                    {formatPosMoney(cash.rounding, { currency: false })}
                  </dd>
                </>
              )}
              <dt className="font-medium">{t('change')}</dt>
              <dd
                className="text-right text-2xl font-bold tabular-nums"
                data-testid="payment-change"
              >
                {formatPosMoney(rappen(change !== null && change > 0 ? change : 0))}
              </dd>
            </dl>
            {change !== null && change < 0 && (
              <p className="text-sm font-medium text-destructive">
                {t('missing', { amount: formatPosMoney(rappen(-change)) })}
              </p>
            )}
            {change !== null && change > 0 && amount !== null && tendered !== null && (
              <Button
                type="button"
                variant="outline"
                className="justify-self-start"
                onClick={() => {
                  setTipText(toAmountText(tendered - amount));
                  setError(null);
                }}
              >
                {t('changeAsTip')}
              </Button>
            )}
          </div>
        )}

        {(method === 'card' || method === 'twint') && (
          <div className="grid gap-3">
            <p className="rounded-lg bg-muted px-3 py-2 text-sm">{t('terminalHint')}</p>
            <AmountField
              id="payment-approved"
              label={t('approved')}
              size="md"
              {...field('approved')}
              invalid={approved === null || (amount !== null && approved < amount)}
              hint={
                error === null && approved !== null && amount !== null && approved < amount
                  ? te('approvedBelowAmount')
                  : undefined
              }
            />
            {terminalTip !== null && terminalTip > 0 && (
              <p className="flex items-baseline justify-between gap-3 text-sm">
                <span>
                  {t('terminalTip')}
                  {waiter ? ` · ${t('tipFor', { name: waiter })}` : ''}
                </span>
                <span
                  className="text-base font-semibold tabular-nums"
                  data-testid="payment-terminal-tip"
                >
                  {formatPosMoney(rappen(terminalTip))}
                </span>
              </p>
            )}
          </div>
        )}

        <fieldset className="grid gap-3 border-t pt-4">
          <legend className="sr-only">{t('receiptOptions')}</legend>
          <h3 className="text-sm font-medium text-muted-foreground" aria-hidden>
            {t('receiptOptions')}
          </h3>
          <div className="grid gap-1.5">
            <div className="flex min-h-5 items-center justify-between gap-2">
              <Label htmlFor="payment-customer-name">{t('customerName')}</Label>
              {customerRequired ? (
                <Badge variant="warning">{t('required')}</Badge>
              ) : (
                <span className="text-xs text-muted-foreground">{t('optional')}</span>
              )}
            </div>
            <Input
              ref={nameRef}
              id="payment-customer-name"
              autoComplete="off"
              maxLength={200}
              value={customerName}
              aria-required={customerRequired || undefined}
              aria-invalid={
                (customerRequired && customerName.trim() === '' && error !== null) || undefined
              }
              className={cn(customerRequired && 'border-warning ring-[3px] ring-warning/30')}
              onChange={(event) => {
                setCustomerName(event.currentTarget.value);
                setError(null);
              }}
            />
            {customerRequired && (
              <p className="text-sm text-muted-foreground">
                {t('customerRequired', { threshold: formatPosMoney(threshold) })}
              </p>
            )}
          </div>
          <div className="grid gap-1.5">
            <div className="flex min-h-5 items-center justify-between gap-2">
              <Label htmlFor="payment-customer-address">{t('customerAddress')}</Label>
              <span className="text-xs text-muted-foreground">{t('optional')}</span>
            </div>
            <Textarea
              id="payment-customer-address"
              autoComplete="off"
              maxLength={500}
              rows={2}
              value={customerAddress}
              className="min-h-16"
              onChange={(event) => {
                setCustomerAddress(event.currentTarget.value);
                setError(null);
              }}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="payment-language">{t('language')}</Label>
            <Select
              value={language}
              onValueChange={(value) => {
                if (isContentLanguage(value)) setLanguage(value);
              }}
            >
              <SelectTrigger id="payment-language">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {languages.options.map((option) => (
                  <SelectItem key={option} value={option}>
                    {tl(option)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </fieldset>
      </section>

      <aside
        aria-label={t('actionsTitle')}
        className="sticky bottom-0 z-10 grid content-start gap-3 rounded-xl border bg-card p-3 shadow-sm md:static md:col-start-2 md:shadow-none lg:sticky lg:top-3 lg:col-start-auto"
      >
        <div className="hidden gap-2 md:grid">
          <p className="text-sm text-muted-foreground">
            {t('keypadTarget', { field: fieldLabels[keypad.field] })}
          </p>
          <NumPad onDigit={onKey} onBackspace={onBackspace} extraKey="." />
          <Button type="button" variant="ghost" onClick={onClearField}>
            <Eraser /> {t('clearField')}
          </Button>
        </div>
        {collectNow !== null && collectNow > 0 && (
          <p className="flex items-baseline justify-between gap-2">
            <span className="text-sm text-muted-foreground">{t('collectNow')}</span>
            <span className="text-xl font-bold tabular-nums">{formatPosMoney(collectNow)}</span>
          </p>
        )}
        {error && (
          <p
            className="rounded-lg bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
            role="alert"
            data-testid="payment-error"
          >
            {error}
          </p>
        )}
        <Button
          type="button"
          size="lg"
          className="w-full"
          disabled={busy}
          aria-busy={busy || undefined}
          onClick={() => void confirm()}
        >
          {t('confirm')}
        </Button>
      </aside>
    </>
  );
}
