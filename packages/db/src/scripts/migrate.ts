import { loadRootEnv, requireEnv } from '../env';
import { migrateDatabase } from '../ops';

loadRootEnv();

// The cloud and the location hub share the same schema and the same migrations.
for (const name of ['DATABASE_URL', 'HUB_DATABASE_URL']) {
  await migrateDatabase(requireEnv(name));
  console.log(`✓ Migrations applied (${name})`);
}
