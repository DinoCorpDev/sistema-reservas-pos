import { Card, CardDescription, CardHeader, CardTitle } from '@pos/ui/card';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HelpShell } from '@/help/help-shell';
import { HELP_CHROME, HELP_ROLES, isHelpLanguage } from '@/help/manuals';

export const metadata: Metadata = { title: 'Hilfe' };

/** The manuals of every role (RNF-21). Public: they hold no data of any restaurant. */
export default async function HelpLanguagePage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isHelpLanguage(lang)) notFound();
  const chrome = HELP_CHROME[lang];
  return (
    <HelpShell lang={lang} role={null}>
      <p className="text-muted-foreground">{chrome.description}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {HELP_ROLES.map((role) => (
          <Link key={role} href={`/help/${lang}/${role}`} className="rounded-xl hover:bg-accent">
            <Card className="h-full bg-transparent">
              <CardHeader>
                <CardTitle>{chrome.roles[role]}</CardTitle>
                <CardDescription>{chrome.roleHints[role]}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </HelpShell>
  );
}
