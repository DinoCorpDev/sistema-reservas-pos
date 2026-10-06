import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';

/** Backoffice guard: signed-in users, or support staff inside an organization (RF-A10). */
export default async function BackofficeLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  if (session.user.kind === 'support' && !session.user.organizationId) redirect('/support');
  return children;
}
