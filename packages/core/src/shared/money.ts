/**
 * Dinero del Core POS (PA-08, RN-06).
 *
 * Todos los montos son enteros en rappen (1 CHF = 100 Rp). Nunca se usa float para montos:
 * la única división permitida aquí es la del redondeo a 0,05 CHF, que vuelve a entero de inmediato.
 */

declare const rappenBrand: unique symbol;

/** Monto entero en rappen. Construir siempre con `rappen()` o `parseChf()`. */
export type Rappen = number & { readonly [rappenBrand]: true };

export class MoneyError extends Error {
  override readonly name = 'MoneyError';
}

export function rappen(value: number): Rappen {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`A Rappen amount must be a safe integer, got ${value}`);
  }
  return value as Rappen;
}

export const ZERO_RAPPEN: Rappen = rappen(0);

export function addRappen(...values: readonly Rappen[]): Rappen {
  return rappen(values.reduce<number>((sum, value) => sum + value, 0));
}

export function subtractRappen(minuend: Rappen, subtrahend: Rappen): Rappen {
  return rappen(minuend - subtrahend);
}

export function multiplyRappen(amount: Rappen, quantity: number): Rappen {
  if (!Number.isSafeInteger(quantity)) {
    throw new MoneyError(`Quantity must be an integer, got ${quantity}`);
  }
  return rappen(amount * quantity);
}

const CHF_INPUT = /^(-)?(\d{1,3}(?:'\d{3})+|\d+)(?:[.,](\d{1,2}))?$/;

/**
 * Convierte un texto en CHF a rappen sin pasar por float.
 * Acepta `12`, `12.5`, `12.50`, `12,50`, `1'234.50` y negativos. Rechaza más de 2 decimales.
 */
export function parseChf(input: string): Rappen {
  const match = CHF_INPUT.exec(input.trim().replace(/^CHF\s*/i, ''));
  if (!match) {
    throw new MoneyError(`Invalid CHF amount: "${input}"`);
  }
  const [, sign, francsRaw = '0', centsRaw = ''] = match;
  const francs = Number(francsRaw.replaceAll("'", ''));
  const cents = Number(centsRaw.padEnd(2, '0'));
  const value = francs * 100 + cents;
  return rappen(sign ? -value : value);
}

/** Formato suizo con apóstrofo ASCII como separador de miles: `CHF 1'234.50`. */
export function formatChf(amount: Rappen, options: { currency?: boolean } = {}): string {
  const { currency = true } = options;
  const negative = amount < 0;
  const absolute = Math.abs(amount);
  const francs = Math.trunc(absolute / 100);
  const cents = absolute % 100;
  const grouped = String(francs).replace(/\B(?=(\d{3})+(?!\d))/g, "'");
  const number = `${negative ? '-' : ''}${grouped}.${String(cents).padStart(2, '0')}`;
  return currency ? `CHF ${number}` : number;
}

export interface CashRounding {
  /** Total a cobrar en efectivo, múltiplo de 5 Rp. */
  payable: Rappen;
  /** Diferencia `payable - amount`; se registra como redondeo, nunca como descuento (RN-06). */
  rounding: Rappen;
}

/**
 * Redondeo comercial suizo a 0,05 CHF. Solo se aplica al total pagado en efectivo (RN-06).
 * Restos de 1-2 Rp bajan, de 3-4 Rp suben; es simétrico para montos negativos (devoluciones).
 */
export function roundCashTo5(amount: Rappen): CashRounding {
  const magnitude = Math.abs(amount);
  const remainder = magnitude % 5;
  const roundedMagnitude = remainder <= 2 ? magnitude - remainder : magnitude + (5 - remainder);
  // `+ 0` normaliza -0 a 0 (por ejemplo -2 Rp redondea a 0, no a -0).
  const payable = rappen((amount < 0 ? -roundedMagnitude : roundedMagnitude) + 0);
  return { payable, rounding: subtractRappen(payable, amount) };
}
