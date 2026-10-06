import { Button } from '@pos/ui/button';
import Link from 'next/link';

const MODULES = [
  {
    href: '/pos',
    title: 'Kasse & Service',
    description: 'Tischplan, Bestellungen, Zahlung (Tablet & Handheld)',
  },
  { href: '/kds', title: 'Küche (KDS)', description: 'Bons pro Station, Zeiten, Status' },
  { href: '/backoffice', title: 'Backoffice', description: 'Einrichtung, Katalog, MWST, Berichte' },
] as const;

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-4xl flex-col justify-center gap-8 p-6">
      <header className="space-y-2">
        <h1 className="text-4xl font-semibold">Sistema Reservas POS</h1>
        <p className="text-lg text-muted-foreground">
          Tisch → Bestellung → Küche → Zahlung → Abschluss. Auch ohne Internet.
        </p>
      </header>
      <nav className="grid gap-4 sm:grid-cols-3">
        {MODULES.map((module) => (
          <Button
            key={module.href}
            asChild
            variant="outline"
            size="pos"
            className="h-auto items-start p-5 text-left"
          >
            <Link href={module.href}>
              <span className="text-lg font-semibold">{module.title}</span>
              <span className="text-sm whitespace-normal text-muted-foreground">
                {module.description}
              </span>
            </Link>
          </Button>
        ))}
      </nav>
    </main>
  );
}
