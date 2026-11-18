'use client';

import { readyToServe, type ServiceGroup } from '@pos/core';
import { Button } from '@pos/ui/button';
import { toast } from '@pos/ui/toaster';
import { cn } from '@pos/ui/utils';
import { Archive, Beer, LayoutGrid, ListOrdered, Lock, ShoppingBag, Wallet } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { lockTerminal } from '@/device/pin';
import { usePos } from '@/device/store';
import { HelpLink } from '@/device/ui/help-link';
import { LanguageMenu } from '@/device/ui/language-menu';
import { StatusIndicator } from '@/device/ui/status-indicator';
import { TrainingBand } from '@/device/ui/training-band';
import { hasCashDrawer, hubReceiptPrinter, openDrawer } from '../actions';
import { requestApproval, usePosUi } from '../ui-store';
import { ApprovalDialog } from './approval-dialog';
import { CashView } from './cash-view';
import { CounterView } from './counter-view';
import { FloorView } from './floor-view';
import { KitchenNotices } from './kitchen-notices';
import { useFoldMemo } from './order/hooks';
import { OrderView } from './order-view';
import { OrdersView } from './orders-view';
import { PaymentView } from './payment-view';
import { PhonePairingButton, SignOutButton } from './phone-access';
import { ReceiptView } from './receipt-view';
import { SendConfirmDialog } from './send-confirm-dialog';
import { TableNotices } from './table-notices';
import { UnpairButton } from './unpair-button';
import { UnsentDialog } from './unsent-dialog';
import { ZitasMark } from '@/components/brand/zitas-logo';

/** Permissions that open the cash screen: running a shift, moving cash or closing the day. */
const CASH_PERMISSIONS = ['shift.open', 'shift.close', 'cash.movement', 'day.close'] as const;

/** Frame of every POS screen: location, navigation, connection status and the person (RF-C19). */
export function PosShell() {
  const t = useTranslations('pos.shell');
  const view = usePosUi((state) => state.view);
  const navigate = usePosUi((state) => state.navigate);
  const user = usePos((state) => state.user);
  const location = usePos((state) => state.bootstrap?.location.name);
  // The cashier POS pairs waiters' phones; a waiter's phone signs out of its shift (DEC-036).
  const terminalType = usePos((state) => state.bootstrap?.terminal.type);
  // The hub's printers and the connection decide what the header offers (DEC-031).
  usePos((state) => state.printers);
  usePos((state) => state.sync.level);
  const printer = hubReceiptPrinter();
  const drawer = hasCashDrawer();
  // What this waiter has ready at the pass, per place (DEC-034).
  const ready = useFoldMemo(
    (fold) => (user ? readyToServe(fold, user.id) : { tables: 0, bar: 0, takeaway: 0 }),
    [user?.id],
  );

  /** Opens the cash drawer without a sale: permission or a manager's PIN (RF-D18). */
  async function drawerOpen() {
    const approval = await requestApproval({ kind: 'open_drawer' });
    if (approval === null) return;
    try {
      await openDrawer(null, approval === 'allowed' ? null : approval);
      toast.success(t('drawerOpened'));
    } catch {
      toast.error(t('drawerFailed'));
    }
  }

  // On a phone held upright (DEC-036) the places are a tab bar at the bottom, in reach of the
  // thumb, and hide inside an order, which has its own action bar there. From md up they sit in
  // the header, as on the tablets.
  const inOrder = view.name === 'order' || view.name === 'payment' || view.name === 'receipt';
  const tab = (active: boolean) =>
    cn(
      'relative gap-2',
      'max-md:h-16 max-md:flex-col max-md:gap-0.5 max-md:rounded-none max-md:px-1 max-md:text-xs',
      active && 'bg-accent max-md:bg-transparent max-md:text-primary',
    );
  const badge = (group: ServiceGroup) => (
    <ReadyBadge
      count={ready[group]}
      label={t(group === 'tables' ? 'readyTables' : 'readyOrders', { count: ready[group] })}
      testId={`ready-badge-${group}`}
    />
  );
  // The cash screen is for whoever may run a shift or close the day (RF-D12, RF-D15): a role
  // without those permissions in the backoffice does not see it.
  const canCash = CASH_PERMISSIONS.some((permission) => user?.permissions.has(permission));
  const atCounter = (channel: 'bar' | 'takeaway') =>
    view.name === 'counter' && view.channel === channel;
  return (
    <div className="flex min-h-dvh flex-col">
      <TrainingBand />
      <SubscriptionNotice />
      <header className="sticky top-0 z-20 flex items-center gap-2 border-b bg-card px-3 py-2 max-md:min-h-14 md:static md:flex-wrap">
        <span className="mr-2 hidden items-center gap-2 font-semibold md:inline-flex">
          <ZitasMark className="size-6" />
          {location}
        </span>
        <nav
          className={cn(
            'flex flex-wrap gap-1',
            'max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-30 max-md:grid max-md:gap-0 max-md:border-t max-md:bg-card max-md:pb-[env(safe-area-inset-bottom)] max-md:shadow-[0_-1px_8px_rgb(0_0_0/0.06)]',
            canCash ? 'max-md:grid-cols-5' : 'max-md:grid-cols-4',
            inOrder && 'max-md:hidden',
          )}
          aria-label={t('navigation')}
        >
          <Button
            variant="ghost"
            className={tab(view.name === 'floor')}
            onClick={() => navigate({ name: 'floor' })}
          >
            <LayoutGrid /> {t('floor')}
            {badge('tables')}
          </Button>
          <Button
            variant="ghost"
            className={tab(view.name === 'orders')}
            onClick={() => navigate({ name: 'orders' })}
          >
            <ListOrdered /> {t('orders')}
          </Button>
          <Button
            variant="ghost"
            className={tab(atCounter('bar'))}
            onClick={() => navigate({ name: 'counter', channel: 'bar' })}
          >
            <Beer /> {t('bar')}
            {badge('bar')}
          </Button>
          <Button
            variant="ghost"
            className={tab(atCounter('takeaway'))}
            onClick={() => navigate({ name: 'counter', channel: 'takeaway' })}
          >
            <ShoppingBag /> {t('takeaway')}
            {badge('takeaway')}
          </Button>
          {canCash && (
            <Button
              variant="ghost"
              className={tab(view.name === 'cash')}
              onClick={() => navigate({ name: 'cash' })}
              data-testid="nav-cash"
            >
              <Wallet /> {t('cash')}
            </Button>
          )}
        </nav>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2 md:ml-auto md:flex-none md:gap-3">
          {drawer && (
            <Button variant="outline" className="gap-2" onClick={() => void drawerOpen()}>
              <Archive /> <span className="max-md:sr-only">{t('drawer')}</span>
            </Button>
          )}
          {terminalType === 'pos' && <PhonePairingButton />}
          <StatusIndicator className="max-md:mr-auto" />
          <span className="truncate text-sm font-medium" data-testid="pos-user">
            {user?.displayName}
          </span>
          <LanguageMenu />
          <HelpLink role={canCash ? 'manager' : 'waiter'} />
          <Button variant="outline" size="icon" onClick={lockTerminal} aria-label={t('lock')}>
            <Lock />
          </Button>
          {terminalType === 'phone' && <SignOutButton />}
          {terminalType === 'pos' && <UnpairButton />}
        </div>
      </header>
      {printer?.health && !printer.health.ok && (
        <div className="bg-destructive/10 px-4 py-2 text-sm text-destructive" role="alert">
          {t('printerDown', { printer: printer.name, error: printer.health.error ?? '' })}
        </div>
      )}
      <main
        className={cn(
          'flex min-h-0 flex-1 flex-col',
          // Room for the bottom tab bar on a phone.
          !inOrder && 'max-md:pb-[calc(4rem+env(safe-area-inset-bottom))]',
        )}
      >
        {view.name === 'floor' && <FloorView />}
        {view.name === 'orders' && <OrdersView />}
        {view.name === 'cash' && (canCash ? <CashView /> : <FloorView />)}
        {view.name === 'counter' && <CounterView key={view.channel} channel={view.channel} />}
        {view.name === 'order' && <OrderView orderId={view.orderId} />}
        {view.name === 'payment' && <PaymentView orderId={view.orderId} />}
        {view.name === 'receipt' && (
          <ReceiptView
            orderId={view.orderId}
            content={view.content}
            receiptId={view.receiptId}
            copyAt={view.copyAt}
            printedByHub={view.printedByHub}
          />
        )}
      </main>
      <ApprovalDialog />
      <UnsentDialog />
      <SendConfirmDialog />
      <KitchenNotices />
      <TableNotices />
    </div>
  );
}

/** Green bubble on a header button: how many places have something ready (DEC-034). */
function ReadyBadge({ count, label, testId }: { count: number; label: string; testId: string }) {
  if (count === 0) return null;
  return (
    <span
      data-testid={testId}
      title={label}
      className="absolute -top-1.5 -right-1.5 flex h-6 min-w-6 max-md:top-1 max-md:right-[calc(50%-1.75rem)] items-center justify-center rounded-full bg-emerald-600 px-1.5 text-xs font-bold text-white tabular-nums shadow-sm ring-2 ring-card"
    >
      <span aria-hidden>{count}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * A late payment or a suspended subscription (DEC-045): one line above the POS, so staff tell the
 * owner. Selling never stops because of it.
 */
function SubscriptionNotice() {
  const status = usePos((state) => state.bootstrap?.subscriptionStatus ?? 'active');
  const t = useTranslations('pos.subscription');
  if (status === 'active') return null;
  return (
    <p
      role="status"
      data-testid="subscription-notice"
      className={`px-3 py-1 text-center text-sm font-medium ${status === 'suspended' ? 'bg-destructive text-destructive-foreground' : 'bg-amber-100 text-amber-950'}`}
    >
      {t(status)}
    </p>
  );
}
