'use client';

import { Alert } from '@pos/ui/alert';
import { Button } from '@pos/ui/button';
import { LogOutIcon, StoreIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { leaveOrganization } from '@/app/backoffice/actions';
import { useServerAction } from '@/components/backoffice/use-server-action';

/** Shown while the staff member is still inside an organization: back to it, or leave it. */
export function InsideOrganization({ name }: { name: string | null }) {
  const t = useTranslations('supportConsole');
  const router = useRouter();
  const leave = useServerAction(leaveOrganization, {
    successMessage: t('left'),
    onSuccess: () => router.refresh(),
  });

  return (
    <Alert variant="warning" className="flex flex-wrap items-center justify-between gap-3">
      <div className="grid gap-1">
        <p className="font-medium">
          {t('insideTitle')}
          {name ? `: ${name}` : ''}
        </p>
        <p className="text-muted-foreground">{t('insideText')}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link href="/backoffice">
            <StoreIcon /> {t('backToBackoffice')}
          </Link>
        </Button>
        <Button variant="outline" disabled={leave.pending} onClick={() => void leave.run()}>
          <LogOutIcon /> {t('leave')}
        </Button>
      </div>
    </Alert>
  );
}
