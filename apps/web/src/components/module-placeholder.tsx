import { Button } from '@pos/ui/button';
import Link from 'next/link';

/** Temporary screen for a module while its phase is being built. */
export function ModulePlaceholder({
  title,
  subtitle,
  phase,
}: {
  title: string;
  subtitle: string;
  phase: string;
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-6 p-6">
      <p className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
        Zitas POS · {phase}
      </p>
      <h1 className="text-4xl font-semibold">{title}</h1>
      <p className="text-lg text-muted-foreground">{subtitle}</p>
      <div>
        <Button asChild variant="outline">
          <Link href="/">Übersicht</Link>
        </Button>
      </div>
    </main>
  );
}
