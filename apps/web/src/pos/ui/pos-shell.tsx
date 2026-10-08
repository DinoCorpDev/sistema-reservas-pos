'use client';

import { Button } from '@pos/ui/button';
import { toast } from '@pos/ui/toaster';
import { cn } from '@pos/ui/utils';
import { Archive, Beer, LayoutGrid, ListOrdered, Lock, ShoppingBag } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { lockTerminal } from '@/device/pin';
import { activateWaitingWorker } from '@/device/service-worker';
import { usePos } from '@/device/store';
import { StatusIndicator } from '@/device/ui/status-indicator';
import { hasCashDrawer, hubReceiptPrinter, openDrawer, openOrder } from '../actions';
import { requestApproval, usePosUi } from '../ui-store';
import { ApprovalDialog } from './approval-dialog';
import { FloorView } from './floor-view';
import { KitchenNotices } from './kitchen-notices';
import { OrderView } from './order-view';
import { OrdersView } from './orders-view';
import { PaymentView } from './payment-view';
import { ReceiptView } from './receipt-view';
import { UnsentDialog } from './unsent-dialog';

/** Frame of every POS screen: location, navigation, connection status and the person (RF-C19). */
export function PosShell() {
  const t = useTranslations('pos.shell');
  const view = usePosUi((state) => state.view);
  const navigate = usePosUi((state) => state.navigate);
  const user = usePos((state) => state.user);
  const location = usePos((state) => state.bootstrap?.location.name);
  const updateWaiting = usePos((state) => state.updateWaiting);
  // The hub's printers and the connection decide what the header offers (DEC-031).
  usePos((state) => state.printers);
  usePos((state) => state.sync.level);
  const printer = hubReceiptPrinter();
  const drawer = hasCashDrawer();

  async function quickOrder(channel: 'bar' | 'takeaway') {
    const orderId = await openOrder({ channel });
    navigate({ name: 'order', orderId });
  }

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

  async function update() {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) activateWaitingWorker(registration);
  }

  const tab = (active: boolean) => cn('gap-2', active && 'bg-accent');
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
          </Button>
          <Button
            variant="ghost"
            className={tab(view.name === 'orders')}
            onClick={() => navigate({ name: 'orders' })}
          >
            <ListOrdered /> {t('orders')}
          </Button>
          <Button variant="ghost" className="gap-2" onClick={() => void quickOrder('bar')}>
            <Beer /> {t('bar')}
          </Button>
          <Button variant="ghost" className="gap-2" onClick={() => void quickOrder('takeaway')}>
            <ShoppingBag /> {t('takeaway')}
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
      {updateWaiting && view.name === 'floor' && (
        <div className="flex items-center justify-between gap-2 bg-sky-50 px-4 py-2 text-sm text-sky-900">
          <span>{t('updateAvailable')}</span>
          <Button size="default" variant="outline" onClick={() => void update()}>
            {t('updateNow')}
          </Button>
        </div>
      )}
      <main className="flex min-h-0 flex-1 flex-col">
        {view.name === 'floor' && <FloorView />}
        {view.name === 'orders' && <OrdersView />}
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
      <KitchenNotices />
    </div>
  );
}
