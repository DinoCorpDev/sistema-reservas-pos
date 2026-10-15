export * from './actor';
export * from './errors';
export { createApiApp, API_BASE_PATH, type ApiDependencies } from './http/app';
export type { BackofficeSession, SessionResolver } from './auth/resolve-actor';
export { resolveActor, resolveTerminal, hasActiveSupportGrant } from './auth/resolve-actor';
export { loadUserPermissions } from './auth/permissions';
export * from './auth/tokens';
export { API_KEY_SCOPE_NAMES, type ApiKeyScope } from './auth/api-keys';
export type { ServiceDeps } from './services/shared';
export type { AreaDto, LocationDto, TableDto } from './services/locations';
export type { BootstrapDto } from './services/pos/bootstrap';
export type { OfflineCredentials } from './services/people/terminal-auth';
export type { OrderDto, OrderSummaryDto } from './services/orders';
export type { ClosingDetail, ClosingDto, DayCloseBlockers, DayClosePreview } from './services/cash';
export type {
  HubConfigDto,
  PulledOperation,
  PushResult,
  SyncConflictDto,
  SyncDeps,
  SyncNode,
} from './services/sync';
// Use cases, shared by the REST API and the backoffice Server Actions.
export * as account from './services/account';
export * as locations from './services/locations';
export * as people from './services/people';
export * as catalog from './services/catalog';
export * as admin from './services/admin';
export * as orders from './services/orders';
export * as sync from './services/sync';
export * as cash from './services/cash';
export * as reports from './services/reports';
