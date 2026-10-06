import {
  authorize,
  type AuthorizationDecision,
  type LocationSettings,
  type Permission,
  type SensitiveAction,
} from '@pos/core';
import type { TenantContext } from '@pos/db';
import { ApiError } from './errors';

/** A manager's one-time approval presented with the request (RF-A05, RN-15). */
export interface Approval {
  approverUserId: string;
  permissions: readonly Permission[];
  /** The action the approval was issued for, e.g. `void_item:<itemId>`. */
  action: string;
}

/**
 * Who is calling, resolved by the HTTP layer or by a Server Action (RNF-10: permissions are
 * checked on the server and in the domain, never only on screen).
 * - `user`: backoffice session or POS terminal unlocked with a PIN.
 * - `api_key`: an organization's integration credential (RF-F14).
 * - `support`: DINOLABS staff inside an organization with the owner's grant (RF-A10).
 */
export interface Actor extends TenantContext {
  kind: 'user' | 'api_key' | 'support';
  permissions: ReadonlySet<Permission>;
  /** API key scopes (only for `api_key`). */
  scopes?: ReadonlySet<string>;
  approval?: Approval | null;
}

export function hasPermission(actor: Actor, permission: Permission): boolean {
  return actor.permissions.has(permission);
}

export function assertPermission(actor: Actor, ...permissions: Permission[]): void {
  const missing = permissions.filter((p) => !actor.permissions.has(p));
  if (missing.length > 0) {
    throw new ApiError('FORBIDDEN', `Missing permission: ${missing.join(', ')}`, { missing });
  }
}

export function requireLocationId(actor: Actor): string {
  if (!actor.locationId) {
    throw new ApiError('BAD_REQUEST', 'Select a location first (X-Location-Id header or session)');
  }
  return actor.locationId;
}

export function requireUserId(actor: Actor): string {
  if (!actor.userId) throw new ApiError('FORBIDDEN', 'This action needs a signed-in user');
  return actor.userId;
}

/**
 * Applies RN-15: the action runs directly, or it needs a manager approval issued for exactly this
 * action (`actionKey`) and covering the required permissions. Returns the context to use for the
 * audit record (with `authorizedByUserId` when an approval was used).
 */
export function assertAuthorized(
  actor: Actor,
  action: SensitiveAction,
  settings: LocationSettings,
  actionKey: string,
): { decision: AuthorizationDecision; actor: Actor } {
  const decision = authorize(actor, action, settings);
  if (decision.status === 'allowed') return { decision, actor };
  const approval = actor.approval;
  const covers =
    approval &&
    approval.action === actionKey &&
    decision.permissions.every((p) => approval.permissions.includes(p));
  if (!covers) {
    throw new ApiError('APPROVAL_REQUIRED', 'A manager must approve this action with their PIN', {
      ...decision,
      action: actionKey,
    });
  }
  return { decision, actor: { ...actor, authorizedByUserId: approval.approverUserId } };
}
