'use client';

import { useRouter } from 'next/navigation';
import { PasswordForm } from '@/components/backoffice/password-form';

export function ForcedPasswordChange() {
  const router = useRouter();
  return <PasswordForm onDone={() => router.replace('/backoffice')} />;
}
