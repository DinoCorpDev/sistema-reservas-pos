import { createDb } from '../client';
import { loadRootEnv, requireEnv } from '../env';
import { createDatabase, migrateDatabase } from '../ops';
import { seedDemoRestaurant } from '../seed/demo';

/** Creates the cloud and hub databases, runs migrations and seeds the demo restaurant (cloud). */
loadRootEnv();
const reset = process.argv.includes('--reset');
const cloudUrl = requireEnv('DATABASE_URL');
const hubUrl = requireEnv('HUB_DATABASE_URL');

for (const url of [cloudUrl, hubUrl]) {
  const database = await createDatabase(url, { reset });
  await migrateDatabase(url);
  console.log(`✓ ${database}: ${reset ? 'recreated' : 'ready'} and migrated`);
}

const { db, pool } = createDb(cloudUrl, { connectionLimit: 2 });
try {
  const result = await seedDemoRestaurant(db);
  console.log(
    result.status === 'created'
      ? '✓ Seeded "Restaurant Demo Zürich"'
      : '• Demo data already present (use --reset to start over)',
  );
} finally {
  await pool.end();
}
