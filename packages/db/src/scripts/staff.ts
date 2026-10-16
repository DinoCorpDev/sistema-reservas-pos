import { eq } from 'drizzle-orm';
import { createDb } from '../client';
import { loadRootEnv, requireEnv } from '../env';
import { platformStaff } from '../schema';
import { hashPassword, randomToken } from '../security';

/**
 * Adds a DINOLABS support account for /support (RF-A10), or gives an existing one a new
 * password. The password is printed once; there is no other way to read it.
 *   pnpm --filter @pos/db staff:add ana@dinolabs.dev "Ana Muster"
 */
loadRootEnv();
const [email, displayName] = process.argv.slice(2);
if (!email || !email.includes('@')) {
  console.error('Usage: staff:add <email> ["Display name"]');
  process.exit(1);
}
const normalized = email.trim().toLowerCase();
const password = randomToken(12);
const passwordHash = await hashPassword(password);

const { db, pool } = createDb(requireEnv('DATABASE_URL'), { connectionLimit: 1 });
try {
  const [existing] = await db
    .select({ id: platformStaff.id })
    .from(platformStaff)
    .where(eq(platformStaff.email, normalized));
  if (existing) {
    await db
      .update(platformStaff)
      .set({ passwordHash, isActive: true, ...(displayName ? { displayName } : {}) })
      .where(eq(platformStaff.id, existing.id));
    console.log(`✓ New password for ${normalized}`);
  } else {
    await db
      .insert(platformStaff)
      .values({ email: normalized, displayName: displayName ?? normalized, passwordHash });
    console.log(`✓ Support account ${normalized} created`);
  }
  console.log(`  Password (shown once): ${password}`);
} finally {
  await pool.end();
}
