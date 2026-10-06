import { loadRootEnv, requireEnv } from '../env';
import { createDatabase } from '../ops';

loadRootEnv();
const reset = process.argv.includes('--reset');

for (const name of ['DATABASE_URL', 'HUB_DATABASE_URL']) {
  const database = await createDatabase(requireEnv(name), { reset });
  console.log(`✓ ${reset ? 'Recreated' : 'Ensured'} database ${database} (${name})`);
}
