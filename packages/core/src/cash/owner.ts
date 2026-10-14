import type { TerminalType } from '../organization/constants';
import type { ShiftMode } from './constants';

/** The drawer or wallet the cash of a sale goes into (RN-19, DEC-038). */
export type ShiftOwner =
  { scope: 'terminal'; terminalId: string } | { scope: 'personal'; userId: string };

/** Terminals with a till: the POS and the restaurant's handhelds. */
const TILL_TYPES: readonly TerminalType[] = ['pos', 'handheld'];

/**
 * Whose shift takes the cash of a sale made by `userId` on this terminal, by the location's
 * cash collection mode (DEC-038). Null = this device takes no cash: a phone when only the till
 * collects it, and kitchen displays and hubs always.
 */
export function shiftOwnerFor(
  mode: ShiftMode,
  terminal: { id: string; type: TerminalType },
  userId: string,
): ShiftOwner | null {
  const till = TILL_TYPES.includes(terminal.type);
  if (!till && terminal.type !== 'phone') return null;
  const personal = mode === 'cashier' || (mode === 'mixed' && terminal.type === 'phone');
  if (personal) return { scope: 'personal', userId };
  return till ? { scope: 'terminal', terminalId: terminal.id } : null;
}

/** Whether two owners are the same drawer or wallet. */
export const sameShiftOwner = (a: ShiftOwner, b: ShiftOwner): boolean =>
  a.scope === 'terminal'
    ? b.scope === 'terminal' && a.terminalId === b.terminalId
    : b.scope === 'personal' && a.userId === b.userId;
