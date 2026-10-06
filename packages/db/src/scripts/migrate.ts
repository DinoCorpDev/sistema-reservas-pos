import { loadRootEnv, requireEnv } from '../env';
import { migrateDatabase } from '../ops';

loadRootEnv();

// La nube y el hub de la sede comparten el mismo esquema y las mismas migraciones.
for (const name of ['DATABASE_URL', 'HUB_DATABASE_URL']) {
  await migrateDatabase(requireEnv(name));
  console.log(`✓ Migrations applied (${name})`);
}
