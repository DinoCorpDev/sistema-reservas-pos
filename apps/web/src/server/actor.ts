import 'server-only';
import { type Actor, resolveActor, type ServiceDeps } from '@pos/api';
import { redirect } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { auth, backofficeSession } from '@/auth';
import { getDb } from './db';

/**
 * Actor of a Server Component or Server Action, resolved exactly like an API request, so the
 * backoffice runs the same use cases with the same permission checks (RNF-10).
 */
export async function currentActor(): Promise<Actor> {
  const session = await backofficeSession();
  if (!session) redirect('/login');
  const actor = await resolveActor(getDb(), {
    authorization: null,
    locationHeader: null,
    terminalToken: null,
    approvalToken: null,
    session,
    requestId: randomUUID(),
  });
  if (!actor) redirect('/login');
  return actor;
}

export function deps(): ServiceDeps {
  return { db: getDb() };
}

/** Signed-in backoffice user or support staff, or redirect to the matching login. */
export async function requireSession() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  return session;
}
