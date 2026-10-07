import { type Rappen, rappen } from '../shared/money';
import type { PaymentAdapterKey, PaymentMethod } from './constants';
import { type PaymentBreakdown, PaymentRuleError, settleCash, settleNonCash } from './settlement';

/**
 * Payment adapters (PA-04, RF-D10). The order engine only receives a completed payment
 * (`payment.record`); how the money was taken is the adapter's business. A new provider is a new
 * adapter: neither the order engine nor the cash module change.
 */

export interface PaymentRequest {
  /** Open balance of the order when the payment starts (Rp). */
  balanceRappen: Rappen;
  /** Part of the balance this payment settles (the sale), ≤ the balance. */
  amountRappen: Rappen;
  tipRappen?: Rappen;
  /** Cash: what the guest hands over. */
  tenderedRappen?: Rappen;
  /** External terminal: the amount approved on the terminal (sale + tip). */
  approvedRappen?: Rappen;
}

export interface PaymentAdapter {
  key: PaymentAdapterKey;
  methods: readonly PaymentMethod[];
  /** Usable without internet in the location (RNF-02). */
  availableOffline: boolean;
  settle(request: PaymentRequest): PaymentBreakdown;
}

function assertWithinBalance(request: PaymentRequest): void {
  if (request.amountRappen <= 0) {
    throw new PaymentRuleError('INVALID_AMOUNT', 'A payment must settle a positive amount');
  }
  if (request.amountRappen > request.balanceRappen) {
    throw new PaymentRuleError(
      'INVALID_AMOUNT',
      `The payment (${request.amountRappen} Rp) exceeds the open balance (${request.balanceRappen} Rp)`,
    );
  }
}

/** Cash in CHF with the 0.05 rounding of what is handed over (RF-D03, RN-06). */
export const cashAdapter: PaymentAdapter = {
  key: 'cash',
  methods: ['cash'],
  availableOffline: true,
  settle(request) {
    assertWithinBalance(request);
    return settleCash({
      amountRappen: request.amountRappen,
      tipRappen: request.tipRappen,
      tenderedRappen: request.tenderedRappen,
    });
  },
};

/**
 * Independent card/TWINT terminal (RF-D04): the cashier types the amount on the terminal and
 * confirms the approved amount here. If the guest added a tip on the terminal, the approved
 * amount exceeds the sale and the difference is the tip (RF-D06).
 */
export const externalTerminalAdapter: PaymentAdapter = {
  key: 'external-terminal',
  methods: ['card', 'twint'],
  availableOffline: true,
  settle(request) {
    assertWithinBalance(request);
    const approved =
      request.approvedRappen ?? rappen(request.amountRappen + (request.tipRappen ?? 0));
    if (approved < request.amountRappen) {
      throw new PaymentRuleError(
        'INVALID_AMOUNT',
        `The approved amount (${approved} Rp) is below the amount to settle (${request.amountRappen} Rp)`,
      );
    }
    return settleNonCash({
      amountRappen: request.amountRappen,
      tipRappen: rappen(approved - request.amountRappen),
    });
  },
};

/** Online payment (TWINT/card for QR and web): a stub until the provider is chosen (DEC-003). */
export const onlineAdapter: PaymentAdapter = {
  key: 'online',
  methods: ['online'],
  availableOffline: false,
  settle() {
    throw new PaymentRuleError('INVALID_AMOUNT', 'Online payments are not available yet (DEC-003)');
  },
};

export const PAYMENT_ADAPTER_REGISTRY: Readonly<Record<PaymentAdapterKey, PaymentAdapter>> = {
  cash: cashAdapter,
  'external-terminal': externalTerminalAdapter,
  online: onlineAdapter,
};
