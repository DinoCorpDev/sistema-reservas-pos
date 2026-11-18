import { Button } from '@pos/ui/button';
import { LogOutIcon } from 'lucide-react';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { auth } from '@/auth';
import { logoutStaff } from './actions';
import { ConsoleNav } from './console-nav';
import { ZitasMark } from '@/components/brand/zitas-logo';

/** Support console guard and shell: DINOLABS staff only (RF-A10, DEC-017). */
export default async function SupportConsoleLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (session?.user?.kind !== 'support' || !session.user.id) redirect('/support/login');
  const t = await getTranslations('supportConsole');

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 flex min-h-16 flex-wrap items-center gap-3 border-b bg-background/95 px-4 backdrop-blur">
        <ZitasMark className="size-7" />
        <span className="font-semibold">{t('title')}</span>
        <ConsoleNav />
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden text-sm text-muted-foreground sm:inline">
            {t('signedInAs', { name: session.user.name ?? '' })}
          </span>
          <form action={logoutStaff}>
            <Button type="submit" variant="ghost">
              <LogOutIcon /> {t('logout')}
            </Button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 p-4 sm:p-6">{children}</main>
    </div>
  );
}
