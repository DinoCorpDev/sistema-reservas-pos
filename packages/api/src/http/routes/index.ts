import type { ApiApp } from '../env';
import { registerAdminRoutes } from './admin';
import { registerCashRoutes } from './cash';
import { registerCatalogRoutes } from './catalog';
import { registerLocationRoutes } from './locations';
import { registerPeopleRoutes } from './people';
import { registerPosRoutes } from './pos';
import { registerSyncRoutes } from './sync';
import { registerSystemRoutes } from './system';

/** Every route module of the API v1. Each module owns one area of the Core. */
export function registerRoutes(app: ApiApp) {
  registerSystemRoutes(app);
  registerLocationRoutes(app);
  registerPeopleRoutes(app);
  registerCatalogRoutes(app);
  registerAdminRoutes(app);
  registerSyncRoutes(app);
  registerPosRoutes(app);
  registerCashRoutes(app);
}
