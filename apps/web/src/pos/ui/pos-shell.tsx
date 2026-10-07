'use client';

import { Button } from '@pos/ui/button';
import { cn } from '@pos/ui/utils';
import { Beer, LayoutGrid, ListOrdered, Lock, ShoppingBag } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { openOrder } from '../actions';
import { lockTerminal } from '../pin';
import { activateWaitingWorker } from '../service-worker';
import { usePos } from '../store';
import { usePosUi } from '../ui-store';
import { ApprovalDialog } from './approval-dialog';
import { FloorView } from './floor-view';
import { OrderView } from './order-view';
import { OrdersView } from './orders-view';
import { PaymentView } from './payment-view';
import { ReceiptView } from './receipt-view';
import { StatusIndicator } from './status-indicator';

/** Frame of every POS screen: location, navigation, connection status and the person (RF-C19). */
export function PosShell() {
  const t = useTranslations('pos.shell');
  const view = usePosUi((state) => state.view);
  const navigate = usePosUi((state) => state.navigate);
  const user = usePos((state) => state.user);
  const location = usePos((state) => state.bootstrap?.location.name);
  const updateWaiting = usePos((state) => state.updateWaiting);

  async function quickOrder(channel: 'bar' | 'takeaway') {
    const orderId = await openOrder({ channel });
    navigate({ name: 'order', orderId });
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
          <StatusIndicator />
          <span className="text-sm font-medium" data-testid="pos-user">
            {user?.displayName}
          </span>
          <Button variant="outline" size="icon" onClick={lockTerminal} aria-label={t('lock')}>
            <Lock />
          </Button>
        </div>
      </header>
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
          <ReceiptView orderId={view.orderId} content={view.content} copyAt={view.copyAt} />
        )}
      </main>
      <ApprovalDialog />
    </div>
  );
}
