import type {
  CashMovementState,
  FoldState,
  PaymentState,
  RefundState,
  ShiftState,
} from '../orders/state';
import { type Rappen, rappen } from '../shared/money';
import { sameShiftOwner, type ShiftOwner } from './owner';

/** Whose cash a shift holds: its terminal's drawer or its person's wallet. */
export const ownerOf = (
  shift: Pick<ShiftState, 'scope' | 'terminalId' | 'cashierUserId'>,
): ShiftOwner =>
  shift.scope === 'terminal'
    ? { scope: 'terminal', terminalId: shift.terminalId }
    : { scope: 'personal', userId: shift.cashierUserId ?? '' };

/**
 * The open shift of a drawer or wallet (RN-19): the first one opened in canonical order, so a
 * second one opened offline on another device is the one flagged.
 */
export function openShiftOf(state: FoldState, owner: ShiftOwner): ShiftState | undefined {
  for (const shift of state.shifts.values()) {
    if (shift.status === 'open' && sameShiftOwner(ownerOf(shift), owner)) return shift;
  }
  return undefined;
}

type CashPayment = Pick<PaymentState, 'method' | 'amountRappen' | 'tipRappen' | 'roundingRappen'>;
type CashRefund = Pick<RefundState, 'method' | 'amountRappen' | 'tipRappen' | 'roundingRappen'>;

/** What a payment put in the drawer: sale + tip + rounding (the change already went back). */
export const collectedOf = (payment: CashPayment): Rappen =>
  rappen(payment.amountRappen + payment.tipRappen + payment.roundingRappen);

/** What a refund took out of it. */
export const paidOutOf = (refund: CashRefund): Rappen =>
  rappen(refund.amountRappen + refund.tipRappen + refund.roundingRappen);

/**
 * Cash that should be in the drawer (RF-D14): the counted float, plus what cash payments
 * collected, minus what cash refunds paid out, plus the movements (signed). Card, TWINT and the
 * other methods never touch the drawer.
 */
export function expectedCash(input: {
  openingFloatRappen: Rappen;
  payments: readonly CashPayment[];
  refunds: readonly CashRefund[];
  movements: readonly Pick<CashMovementState, 'amountRappen'>[];
}): Rappen {
  let total = input.openingFloatRappen as number;
  for (const payment of input.payments) {
    if (payment.method === 'cash') total += collectedOf(payment);
  }
  for (const refund of input.refunds) {
    if (refund.method === 'cash') total -= paidOutOf(refund);
  }
  for (const movement of input.movements) total += movement.amountRappen;
  return rappen(total);
}
