import { loadRootEnv, requireEnv } from '../env';
import { migrateDatabase } from '../ops';

loadRootEnv();

// The cloud and the location hub share the same schema and the same migrations. In production
// each runs alone: the cloud server has no hub database, a hub has no cloud database.
const targets = ['DATABASE_URL', 'HUB_DATABASE_URL'].filter((name) => process.env[name]);
if (targets.length === 0) requireEnv('DATABASE_URL');
for (const name of targets) {
  await migrateDatabase(requireEnv(name));
  console.log(`✓ Migrations applied (${name})`);
}
