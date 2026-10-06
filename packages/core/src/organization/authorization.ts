import type { ItemPrepStatus } from '../orders/constants';
import type { Rappen } from '../shared/money';
import type { Permission } from './permissions';
import type { LocationSettings } from './settings';

/** Anyone acting in the system: a user with the permissions of their roles at this location. */
export interface Actor {
  userId?: string | null;
  permissions: ReadonlySet<Permission>;
}

/**
 * A sensitive action with the facts the thresholds depend on (RF-A05, RN-15).
 * `percentBp` is the effective discount over the discounted amount (2000 = 20 %).
 */
export type SensitiveAction =
  | { kind: 'discount'; percentBp: number }
  | { kind: 'void_item'; prepStatus: ItemPrepStatus }
  | { kind: 'void_order' }
  | { kind: 'refund'; amountRappen: Rappen }
  | { kind: 'reopen_order' }
  | { kind: 'open_drawer' }
  | { kind: 'permission'; permission: Permission };

export type AuthorizationDecision =
  | { status: 'allowed' }
  /** Ask a manager for their PIN on the same device; the approver needs all `permissions`. */
  | { status: 'needs_approval'; permissions: Permission[]; reason: 'missing_permission' | 'above_threshold' };

const BASE_PERMISSION: Record<Exclude<SensitiveAction['kind'], 'permission'>, Permission> = {
  discount: 'order.discount',
  void_item: 'order.void_item',
  void_order: 'order.void',
  refund: 'payment.refund',
  reopen_order: 'order.reopen',
  open_drawer: 'cash.open_drawer',
};

function exceedsThreshold(action: SensitiveAction, settings: LocationSettings): boolean {
  const approval = settings.managerApproval;
  switch (action.kind) {
    case 'discount':
      return action.percentBp > approval.discountAboveBp;
    case 'void_item':
      return approval.voidSentItem && action.prepStatus !== 'pending';
    case 'refund':
      return action.amountRappen > approval.refundAboveRappen;
    default:
      return false;
  }
}

/**
 * Decides whether the actor may perform the action directly or needs a manager's approval
 * (RF-A05, RN-15). Verified on the server and in the domain, never only on screen (RNF-10).
 * Thresholds come from the location settings (DEC-004), never from code.
 */
export function authorize(
  actor: Actor,
  action: SensitiveAction,
  settings: LocationSettings,
): AuthorizationDecision {
  const permission = action.kind === 'permission' ? action.permission : BASE_PERMISSION[action.kind];
  if (!actor.permissions.has(permission)) {
    return {
      status: 'needs_approval',
      permissions: exceedsThreshold(action, settings) ? [permission, 'approval.grant'] : [permission],
      reason: 'missing_permission',
    };
  }
  if (exceedsThreshold(action, settings) && !actor.permissions.has('approval.grant')) {
    return {
      status: 'needs_approval',
      permissions: [permission, 'approval.grant'],
      reason: 'above_threshold',
    };
  }
  return { status: 'allowed' };
}

/** Whether `approver` can authorize a decision that needs approval. */
export function canApprove(approver: Actor, decision: AuthorizationDecision): boolean {
  if (decision.status === 'allowed') return true;
  return decision.permissions.every((permission) => approver.permissions.has(permission));
}

const PIN_PATTERN = /^\d{4,6}$/;

/** POS PIN: 4 to 6 digits (RF-A06). */
export function isValidPin(pin: string): boolean {
  return PIN_PATTERN.test(pin);
}
