import type { OperationApproval, ReceiptContent, SensitiveAction } from '@pos/core';
import { create } from 'zustand';

/**
 * Navigation and dialogs of the POS (UI state only; orders live in the engine). The POS is one
 * client page: no Next navigation, so nothing has to be fetched from the server offline.
 */
export type PosView =
  | { name: 'floor' }
  | { name: 'orders' }
  | { name: 'order'; orderId: string }
  | { name: 'payment'; orderId: string }
  | { name: 'receipt'; orderId: string; content: ReceiptContent; copyAt?: string };

interface ApprovalRequest {
  action: SensitiveAction;
  resolve: (approval: OperationApproval | 'allowed' | null) => void;
}

interface PosUiState {
  view: PosView;
  navigate: (view: PosView) => void;
  approval: ApprovalRequest | null;
}

export const usePosUi = create<PosUiState>((set) => ({
  view: { name: 'floor' },
  navigate: (view) => set({ view }),
  approval: null,
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
