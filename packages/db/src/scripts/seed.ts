import { createDb } from '../client';
import { loadRootEnv, requireEnv } from '../env';
import { seedDemoRestaurant } from '../seed/demo';

loadRootEnv();

const { db, pool } = createDb(requireEnv('DATABASE_URL'), { connectionLimit: 2 });
try {
  const result = await seedDemoRestaurant(db);
  console.log(
    result.status === 'created'
      ? `✓ Seeded "Restaurant Demo Zürich" (organization ${result.organizationId})`
      : `• Demo organization already exists (${result.organizationId}); run "pnpm db:setup --reset" to start over`,
  );
} finally {
  await pool.end();
}
