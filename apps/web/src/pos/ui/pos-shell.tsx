'use client';

import { readyToServe, type ServiceGroup } from '@pos/core';
import { Button } from '@pos/ui/button';
import { toast } from '@pos/ui/toaster';
import { cn } from '@pos/ui/utils';
import { Archive, Beer, LayoutGrid, ListOrdered, Lock, ShoppingBag } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { lockTerminal } from '@/device/pin';
import { usePos } from '@/device/store';
import { StatusIndicator } from '@/device/ui/status-indicator';
import { hasCashDrawer, hubReceiptPrinter, openDrawer } from '../actions';
import { requestApproval, usePosUi } from '../ui-store';
import { ApprovalDialog } from './approval-dialog';
import { CounterView } from './counter-view';
import { FloorView } from './floor-view';
import { KitchenNotices } from './kitchen-notices';
import { useFoldMemo } from './order/hooks';
import { OrderView } from './order-view';
import { OrdersView } from './orders-view';
import { PaymentView } from './payment-view';
import { ReceiptView } from './receipt-view';
import { SendConfirmDialog } from './send-confirm-dialog';
import { UnsentDialog } from './unsent-dialog';

/** Frame of every POS screen: location, navigation, connection status and the person (RF-C19). */
export function PosShell() {
  const t = useTranslations('pos.shell');
  const view = usePosUi((state) => state.view);
  const navigate = usePosUi((state) => state.navigate);
  const user = usePos((state) => state.user);
  const location = usePos((state) => state.bootstrap?.location.name);
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

  const tab = (active: boolean) => cn('relative gap-2', active && 'bg-accent');
  const badge = (group: ServiceGroup) => (
    <ReadyBadge
      count={ready[group]}
      label={t(group === 'tables' ? 'readyTables' : 'readyOrders', { count: ready[group] })}
      testId={`ready-badge-${group}`}
    />
  );
  const atCounter = (channel: 'bar' | 'takeaway') =>
    view.name === 'counter' && view.channel === channel;
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b bg-card px-3 py-2">
        <span className="mr-2 font-semibold">{location}</span>
        <nav className="flex flex-wrap gap-1" aria-label={t('navigation')}>
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
        </nav>
        <div className="ml-auto flex items-center gap-3">
          {drawer && (
            <Button variant="outline" className="gap-2" onClick={() => void drawerOpen()}>
              <Archive /> {t('drawer')}
            </Button>
          )}
          <StatusIndicator />
          <span className="text-sm font-medium" data-testid="pos-user">
            {user?.displayName}
          </span>
          <Button variant="outline" size="icon" onClick={lockTerminal} aria-label={t('lock')}>
            <Lock />
          </Button>
        </div>
      </header>
      {printer?.health && !printer.health.ok && (
        <div className="bg-destructive/10 px-4 py-2 text-sm text-destructive" role="alert">
          {t('printerDown', { printer: printer.name, error: printer.health.error ?? '' })}
        </div>
      )}
      <main className="flex min-h-0 flex-1 flex-col">
        {view.name === 'floor' && <FloorView />}
        {view.name === 'orders' && <OrdersView />}
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
      className="absolute -top-1.5 -right-1.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-emerald-600 px-1.5 text-xs font-bold text-white tabular-nums shadow-sm ring-2 ring-card"
    >
      <span aria-hidden>{count}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
