import {
  itemsOf,
  type OperationApproval,
  type ReceiptContent,
  type Redirect,
  type SensitiveAction,
} from '@pos/core';
import { create } from 'zustand';
import { getPos } from '@/device/store';

/**
 * Navigation and dialogs of the POS (UI state only; orders live in the engine). The POS is one
 * client page: no Next navigation, so nothing has to be fetched from the server offline.
 */
export type PosView =
  | { name: 'floor' }
  | { name: 'orders' }
  /** Open bar or take-away orders and a button to open a new one (DEC-034). */
  | { name: 'counter'; channel: 'bar' | 'takeaway' }
  | { name: 'order'; orderId: string }
  | { name: 'payment'; orderId: string }
  /** The till's or the waiter's cash: shift, movements, count, day close (DEC-038). */
  | { name: 'cash' }
  | {
      name: 'receipt';
      orderId: string;
      content: ReceiptContent;
      /** Original receipt, for printing it through the hub (DEC-031). */
      receiptId?: string;
      copyAt?: string;
      /** The hub already prints this copy. */
      printedByHub?: boolean;
    };

/** The lists an order is opened from: tables, all orders, bar or take-away. */
export type ListView = Extract<PosView, { name: 'floor' | 'orders' | 'counter' }>;

const isList = (view: PosView): view is ListView =>
  view.name === 'floor' || view.name === 'orders' || view.name === 'counter';

interface ApprovalRequest {
  action: SensitiveAction;
  resolve: (approval: OperationApproval | 'allowed' | null) => void;
}

interface PosUiState {
  view: PosView;
  /** Goes to another screen; leaving an order with items not sent yet asks first. */
  navigate: (view: PosView) => void;
  /** Goes there without asking (the waiter already decided). */
  leaveTo: (view: PosView) => void;
  /** The last list shown: leaving an order, its payment or its receipt goes back there. */
  origin: ListView;
  /** Back to the list the order was opened from. */
  goBack: () => void;
  approval: ApprovalRequest | null;
  /** Leaving an order whose items the kitchen has not received yet (RF-C09). */
  leaving: { orderId: string; next: PosView; count: number } | null;
  /** Nobody is at a station these items go to: send them to its replacement? (DEC-033) */
  sendConfirm: { redirected: Redirect[]; resolve: (confirmed: boolean) => void } | null;
}

/** Items of an open order that were added but not sent to the kitchen. */
export function unsentCount(orderId: string): number {
  const { fold } = getPos();
  if (fold.orders.get(orderId)?.status !== 'open') return 0;
  return itemsOf(fold, orderId).filter((item) => item.prepStatus === 'pending').length;
}

export const usePosUi = create<PosUiState>((set, get) => ({
  view: { name: 'floor' },
  navigate: (view) =>
    set((state) => {
      const current = state.view;
      const staysOnOrder =
        (view.name === 'order' || view.name === 'payment') &&
        current.name === 'order' &&
        view.orderId === current.orderId;
      // A dish added and never sent never reaches the kitchen: the waiter must see it.
      if (current.name === 'order' && !staysOnOrder) {
        const count = unsentCount(current.orderId);
        if (count > 0) return { leaving: { orderId: current.orderId, next: view, count } };
      }
      return { view, leaving: null, origin: isList(view) ? view : state.origin };
    }),
  leaveTo: (view) =>
    set((state) => ({ view, leaving: null, origin: isList(view) ? view : state.origin })),
  origin: { name: 'floor' },
  goBack: () => get().navigate(get().origin),
  approval: null,
  leaving: null,
  sendConfirm: null,
}));

/**
 * Asks for a manager's PIN when the action needs it (RN-15, RF-A05). Resolves to 'allowed' when
 * the person on the terminal may do it alone, to the approval, or to null when cancelled.
 */
export function requestApproval(
  action: SensitiveAction,
): Promise<OperationApproval | 'allowed' | null> {
  return new Promise((resolve) => usePosUi.setState({ approval: { action, resolve } }));
}

/**
 * Asks the waiter before sending to a replacement station because nobody is logged in at the
 * station (DEC-033). Resolves to true to send, false to cancel.
 */
export function confirmRedirects(redirected: Redirect[]): Promise<boolean> {
  return new Promise((resolve) => usePosUi.setState({ sendConfirm: { redirected, resolve } }));
}
