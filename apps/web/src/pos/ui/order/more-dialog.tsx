'use client';

import type { Channel, OrderState } from '@pos/core';
import { Button } from '@pos/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@pos/ui/dialog';
import { cn } from '@pos/ui/utils';
import {
  ArrowLeft,
  ArrowRightLeft,
  Ban,
  Link2,
  Merge,
  MoveRight,
  Percent,
  Plus,
  ShoppingBag,
  Split,
  UserRound,
  Users,
  Utensils,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';
import { changeChannel, checkAction, updateOrder, voidOrder } from '../../actions';
import { usePos } from '@/device/store';
import { requestApproval, usePosUi } from '../../ui-store';
import { MergePanel, SplitPanel, TransferPanel } from './bill-panels';
import { DiscountForm } from './discount-form';
import { orderDiscountBase } from './format';
import { type OrderData, useFoldMemo, useOpenOrders } from './hooks';
import { useRunner } from './run';
import { NumberStepper } from './stepper';
import { JoinTablesPanel, MoveTablePanel } from './table-panels';
import { VoidForm, type VoidInput } from './void-form';

type Mode =
  | 'menu'
  | 'discount'
  | 'guests'
  | 'waiter'
  | 'move'
  | 'join'
  | 'transfer'
  | 'merge'
  | 'split'
  | 'channel'
  | 'cancel';

/** Channel an order switches to: take-away, or back to eating in (RN-05). */
const switchedChannel = (order: OrderState): Channel =>
  order.channel === 'takeaway' ? (order.tableId ? 'table' : 'bar') : 'takeaway';

/**
 * Everything else about the order, under "Mehr": order discount (RF-C11), guests and waiter,
 * moving and joining tables (RF-C03), another group at the table (RF-C05), transfer, merge and
 * split (RF-C12, RF-C13), channel change before payment (RN-05) and cancelling (RN-12).
 */
export function MoreDialog({
  data,
  open,
  onClose,
  onNewOrderAtTable,
}: {
  data: OrderData;
  open: boolean;
  onClose: () => void;
  onNewOrderAtTable: () => void;
}) {
  const tc = useTranslations('posOrder.common');
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-2xl" closeLabel={tc('close')}>
        {open && (
          <MoreContent data={data} onClose={onClose} onNewOrderAtTable={onNewOrderAtTable} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function MoreContent({
  data,
  onClose,
  onNewOrderAtTable,
}: {
  data: OrderData;
  onClose: () => void;
  onNewOrderAtTable: () => void;
}) {
  const t = useTranslations('posOrder.more');
  const tc = useTranslations('posOrder.common');
  const [mode, setMode] = useState<Mode>('menu');
  const { order, items, hasPayments } = data;
  const otherOrders = useOpenOrders(order.id).length;
  const validCount = items.filter((item) => item.prepStatus !== 'voided').length;
  // Transfer, merge and split need the permission itself: these operations carry no approval.
  const mayTransfer =
    checkAction({ kind: 'permission', permission: 'order.transfer' }).status === 'allowed';
  const atTable = order.tableId !== null;
  const target = switchedChannel(order);
  const channelLabel = target === 'takeaway' ? t('toTakeaway') : t('toOnPremise');

  const titles: Record<Mode, string> = {
    menu: t('title'),
    discount: t('discount'),
    guests: t('guests'),
    waiter: t('waiter'),
    move: t('move'),
    join: t('join'),
    transfer: t('transfer'),
    merge: t('merge'),
    split: t('split'),
    channel: channelLabel,
    cancel: t('cancel'),
  };

  const billBlocked = hasPayments || !mayTransfer;
  const hints = [
    hasPayments ? t('paidHint') : null,
    !hasPayments && !mayTransfer ? t('noTransferPermission') : null,
    order.paymentStatus !== 'unpaid' ? t('channelPaidHint') : null,
  ].filter((hint): hint is string => hint !== null);

  return (
    <div className="grid gap-5">
      <DialogHeader>
        <DialogTitle>{titles[mode]}</DialogTitle>
        <DialogDescription>{tc('orderNumber', { number: order.displayNumber })}</DialogDescription>
      </DialogHeader>

      {mode !== 'menu' && (
        <Button variant="ghost" className="justify-self-start" onClick={() => setMode('menu')}>
          <ArrowLeft /> {tc('back')}
        </Button>
      )}

      {mode === 'menu' && (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <MenuButton
              icon={<Percent />}
              onClick={() => setMode('discount')}
              disabled={validCount === 0}
            >
              {t('discount')}
            </MenuButton>
            <MenuButton icon={<Users />} onClick={() => setMode('guests')}>
              {t('guests')}
            </MenuButton>
            <MenuButton icon={<UserRound />} onClick={() => setMode('waiter')}>
              {t('waiter')}
            </MenuButton>
            {atTable && (
              <>
                <MenuButton icon={<MoveRight />} onClick={() => setMode('move')}>
                  {t('move')}
                </MenuButton>
                <MenuButton icon={<Link2 />} onClick={() => setMode('join')}>
                  {t('join')}
                </MenuButton>
                <MenuButton icon={<Plus />} onClick={onNewOrderAtTable}>
                  {t('newOrderAtTable')}
                </MenuButton>
              </>
            )}
            <MenuButton
              icon={<ArrowRightLeft />}
              onClick={() => setMode('transfer')}
              disabled={billBlocked || validCount === 0 || otherOrders === 0}
            >
              {t('transfer')}
            </MenuButton>
            <MenuButton
              icon={<Merge />}
              onClick={() => setMode('merge')}
              disabled={billBlocked || otherOrders === 0}
            >
              {t('merge')}
            </MenuButton>
            <MenuButton
              icon={<Split />}
              onClick={() => setMode('split')}
              disabled={billBlocked || validCount < 2}
            >
              {t('split')}
            </MenuButton>
            <MenuButton
              icon={target === 'takeaway' ? <ShoppingBag /> : <Utensils />}
              onClick={() => setMode('channel')}
              disabled={order.paymentStatus !== 'unpaid'}
            >
              {channelLabel}
            </MenuButton>
            <MenuButton
              icon={<Ban />}
              onClick={() => setMode('cancel')}
              disabled={hasPayments}
              destructive
            >
              {t('cancel')}
            </MenuButton>
          </div>
          {hints.length > 0 && (
            <ul className="grid gap-1 text-sm text-muted-foreground">
              {hints.map((hint) => (
                <li key={hint}>{hint}</li>
              ))}
            </ul>
          )}
        </>
      )}

      {mode === 'discount' && <OrderDiscountPanel orderId={order.id} onDone={onClose} />}
      {mode === 'guests' && <GuestsPanel order={order} onDone={onClose} />}
      {mode === 'waiter' && <WaiterPanel order={order} onDone={onClose} />}
      {mode === 'move' && <MoveTablePanel order={order} onDone={onClose} />}
      {mode === 'join' && <JoinTablesPanel order={order} onDone={onClose} />}
      {mode === 'transfer' && <TransferPanel data={data} onDone={onClose} />}
      {mode === 'merge' && <MergePanel data={data} onDone={onClose} />}
      {mode === 'split' && <SplitPanel data={data} onDone={onClose} />}
      {mode === 'channel' && <ChannelPanel order={order} target={target} onDone={onClose} />}
      {mode === 'cancel' && <CancelPanel order={order} onDone={onClose} />}
    </div>
  );
}

function MenuButton({
  icon,
  onClick,
  disabled,
  destructive,
  children,
}: {
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
  children: ReactNode;
}) {
  return (
    <Button
      variant="outline"
      size="lg"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'h-auto min-h-14 justify-start py-3 text-left whitespace-normal',
        destructive && 'border-destructive/40 text-destructive hover:bg-destructive/10',
      )}
    >
      {icon}
      {children}
    </Button>
  );
}

function OrderDiscountPanel({ orderId, onDone }: { orderId: string; onDone: () => void }) {
  const base = useFoldMemo((fold) => orderDiscountBase(fold, orderId), [orderId]);
  return <DiscountForm orderId={orderId} itemId={null} base={base} onDone={onDone} />;
}

function GuestsPanel({ order, onDone }: { order: OrderState; onDone: () => void }) {
  const t = useTranslations('posOrder.openTable');
  const tc = useTranslations('posOrder.common');
  const run = useRunner();
  const [guests, setGuests] = useState<number | null>(order.guestCount || 1);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (guests === null) return;
    setBusy(true);
    const result = await run(() => updateOrder(order.id, { guestCount: guests }));
    setBusy(false);
    if (result.ok) onDone();
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <NumberStepper label={t('guests')} value={guests} onChange={setGuests} min={1} max={99} />
      <Button type="submit" size="lg" disabled={busy || guests === null}>
        {tc('save')}
      </Button>
    </form>
  );
}

/** Another waiter takes over the order, and its tips (RF-C03, RN-07). */
function WaiterPanel({ order, onDone }: { order: OrderState; onDone: () => void }) {
  const users = usePos((state) => state.bootstrap)?.users ?? [];
  const run = useRunner();
  const [busy, setBusy] = useState(false);

  async function choose(userId: string) {
    if (userId === order.waiterUserId) {
      onDone();
      return;
    }
    setBusy(true);
    const result = await run(() => updateOrder(order.id, { waiterUserId: userId }));
    setBusy(false);
    if (result.ok) onDone();
  }

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {users.map((user) => {
        const current = user.id === order.waiterUserId;
        return (
          <Button
            key={user.id}
            size="lg"
            variant={current ? 'default' : 'outline'}
            aria-pressed={current}
            disabled={busy}
            onClick={() => void choose(user.id)}
            className="justify-start"
          >
            <UserRound /> {user.displayName}
          </Button>
        );
      })}
    </div>
  );
}

/** Take-away or eating in, before anything is paid: the MWST of every line is recalculated (RN-05). */
function ChannelPanel({
  order,
  target,
  onDone,
}: {
  order: OrderState;
  target: Channel;
  onDone: () => void;
}) {
  const t = useTranslations('posOrder.more');
  const tch = useTranslations('posOrder.channel');
  const run = useRunner();
  const [busy, setBusy] = useState(false);

  async function change() {
    setBusy(true);
    const result = await run(() => changeChannel(order.id, target));
    setBusy(false);
    if (result.ok) onDone();
  }

  return (
    <div className="grid gap-4">
      <p>{t('channelDescription', { from: tch(order.channel), to: tch(target) })}</p>
      <Button size="lg" disabled={busy} onClick={() => void change()}>
        {t('channelConfirm', { to: tch(target) })}
      </Button>
    </div>
  );
}

/** Cancels an order without payments (RN-12); every line is voided with the reason. */
function CancelPanel({ order, onDone }: { order: OrderState; onDone: () => void }) {
  const t = useTranslations('posOrder.more');
  const navigate = usePosUi((state) => state.navigate);
  const run = useRunner();
  const [busy, setBusy] = useState(false);

  async function cancel(input: VoidInput) {
    setBusy(true);
    const approval = await requestApproval({ kind: 'void_order' });
    const result =
      approval === null
        ? null
        : await run(() =>
            voidOrder(
              order.id,
              input.reason,
              input.reasonText,
              approval === 'allowed' ? null : approval,
            ),
          );
    setBusy(false);
    if (!result?.ok) return;
    onDone();
    navigate({ name: 'floor' });
  }

  return (
    <div className="grid gap-4">
      <p>{t('cancelDescription')}</p>
      <VoidForm maxQuantity={null} busy={busy} onConfirm={(input) => void cancel(input)} />
    </div>
  );
}
