import type { IsoDate } from '../tax/calculation';
import type { OrderNumber } from './operations';

/**
 * Order and receipt numbers (RN-16, RF-C15, DEC-022, DEC-024).
 * - The location's authority (hub or cloud) numbers without prefix: `0042`.
 * - A terminal that cannot reach it numbers with its own prefix: `K1-0007`.
 * Numbers restart every business day and are never reused; gaps are possible.
 */

export function formatOrderNumber(number: number, prefix: string): string {
  if (!Number.isInteger(number) || number < 1) {
    throw new RangeError(`An order number is a positive integer, got ${number}`);
  }
  const digits = String(number).padStart(4, '0');
  return prefix === '' ? digits : `${prefix}-${digits}`;
}

export function orderNumber(businessDate: IsoDate, number: number, prefix = ''): OrderNumber {
  return { businessDate, number, prefix, display: formatOrderNumber(number, prefix) };
}

/**
 * Receipt number `<terminal prefix>-<YYMMDD>-<counter>` (e.g. `K1-261006-0012`): unique without
 * any coordination, because every terminal has its own prefix and its own counter.
 */
export function formatReceiptNumber(
  prefix: string,
  businessDate: IsoDate,
  counter: number,
): string {
  if (!/^[A-Z0-9]{1,4}$/.test(prefix)) {
    throw new RangeError(`A terminal prefix has 1-4 letters or digits, got "${prefix}"`);
  }
  if (!Number.isInteger(counter) || counter < 1) {
    throw new RangeError(`A receipt counter is a positive integer, got ${counter}`);
  }
  const yymmdd = businessDate.slice(2).replaceAll('-', '');
  return `${prefix}-${yymmdd}-${String(counter).padStart(4, '0')}`;
}
