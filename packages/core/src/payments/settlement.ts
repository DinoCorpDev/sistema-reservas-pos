import { addRappen, type Rappen, roundCashTo5, subtractRappen } from '../shared/money';

export class PaymentRuleError extends Error {
  override readonly name = 'PaymentRuleError';
  constructor(
    readonly code: 'INVALID_AMOUNT' | 'INSUFFICIENT_TENDER',
    message: string,
  ) {
    super(message);
  }
}

/**
 * Breakdown of one payment, as stored in `payments`:
 * collected = sale amount + tip + rounding.
 * - `amountRappen` settles the order balance and is the only part that belongs to the sale.
 * - `tipRappen` is outside the sale and carries no MWST (RN-07).
 * - `roundingRappen` is the CHF 0.05 cash rounding, never a discount (RN-06).
 */
export interface PaymentBreakdown {
  amountRappen: Rappen;
  tipRappen: Rappen;
  roundingRappen: Rappen;
  collectedRappen: Rappen;
  tenderedRappen: Rappen | null;
  changeRappen: Rappen;
}

function assertNonNegative(value: Rappen, label: string): void {
  if (value < 0) {
    throw new PaymentRuleError('INVALID_AMOUNT', `${label} cannot be negative`);
  }
}

/**
 * Cash payment (RF-D03): the total handed over in cash (sale + tip) is rounded to CHF 0.05 and the
 * difference is recorded as rounding. The sale amount and the tip are never touched by rounding.
 */
export function settleCash(input: {
  amountRappen: Rappen;
  tipRappen?: Rappen;
  tenderedRappen?: Rappen;
}): PaymentBreakdown {
  const tip = input.tipRappen ?? (0 as Rappen);
  assertNonNegative(input.amountRappen, 'amount');
  assertNonNegative(tip, 'tip');
  const { payable, rounding } = roundCashTo5(addRappen(input.amountRappen, tip));
  const tendered = input.tenderedRappen ?? null;
  if (tendered !== null && tendered < payable) {
    throw new PaymentRuleError(
      'INSUFFICIENT_TENDER',
      `Tendered ${tendered} Rp is less than the ${payable} Rp to collect`,
    );
  }
  return {
    amountRappen: input.amountRappen,
    tipRappen: tip,
    roundingRappen: rounding,
    collectedRappen: payable,
    tenderedRappen: tendered,
    changeRappen: tendered === null ? (0 as Rappen) : subtractRappen(tendered, payable),
  };
}

/** What a refund pays out (`refunds`): paid out = sale amount + tip + rounding. */
export interface RefundBreakdown {
  amountRappen: Rappen;
  tipRappen: Rappen;
  roundingRappen: Rappen;
  paidOutRappen: Rappen;
}

/**
 * Cash refund (RN-06, DEC-038): there are no 1-rappen coins, so what goes back in cash (sale +
 * tip) is rounded to CHF 0.05 like a cash payment and the difference recorded as the refund's
 * rounding. Any other method pays back the exact amount.
 */
export function settleRefund(
  method: 'cash' | 'other',
  input: { amountRappen: Rappen; tipRappen?: Rappen },
): RefundBreakdown {
  const tip = input.tipRappen ?? (0 as Rappen);
  assertNonNegative(input.amountRappen, 'amount');
  assertNonNegative(tip, 'tip');
  const total = addRappen(input.amountRappen, tip);
  const { payable, rounding } =
    method === 'cash' ? roundCashTo5(total) : { payable: total, rounding: 0 as Rappen };
  return {
    amountRappen: input.amountRappen,
    tipRappen: tip,
    roundingRappen: rounding,
    paidOutRappen: payable,
  };
}

/** Card, TWINT or any non-cash payment: no rounding, the tip stays outside the sale (RN-07). */
export function settleNonCash(input: {
  amountRappen: Rappen;
  tipRappen?: Rappen;
}): PaymentBreakdown {
  const tip = input.tipRappen ?? (0 as Rappen);
  assertNonNegative(input.amountRappen, 'amount');
  assertNonNegative(tip, 'tip');
  return {
    amountRappen: input.amountRappen,
    tipRappen: tip,
    roundingRappen: 0 as Rappen,
    collectedRappen: addRappen(input.amountRappen, tip),
    tenderedRappen: null,
    changeRappen: 0 as Rappen,
  };
}
