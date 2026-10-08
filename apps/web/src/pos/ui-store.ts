import {
  itemsOf,
  type OperationApproval,
  type ReceiptContent,
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
  | { name: 'order'; orderId: string }
  | { name: 'payment'; orderId: string }
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
  approval: ApprovalRequest | null;
  /** Leaving an order whose items the kitchen has not received yet (RF-C09). */
  leaving: { orderId: string; next: PosView; count: number } | null;
}

/** Items of an open order that were added but not sent to the kitchen. */
export function unsentCount(orderId: string): number {
  const { fold } = getPos();
  if (fold.orders.get(orderId)?.status !== 'open') return 0;
  return itemsOf(fold, orderId).filter((item) => item.prepStatus === 'pending').length;
}

export const usePosUi = create<PosUiState>((set) => ({
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
      return { view, leaving: null };
    }),
  leaveTo: (view) => set({ view, leaving: null }),
  approval: null,
  leaving: null,
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
