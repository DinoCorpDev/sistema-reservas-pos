import { Alert } from '@pos/ui/alert';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { HelpShell } from '@/help/help-shell';
import { HELP_CHROME, isHelpLanguage, isHelpRole, MANUALS } from '@/help/manuals';

type Params = Promise<{ lang: string; role: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { lang, role } = await params;
  if (!isHelpLanguage(lang) || !isHelpRole(role)) return {};
  return { title: `${HELP_CHROME[lang].title} · ${HELP_CHROME[lang].roles[role]}` };
}

/**
 * A role's manual (RNF-21): numbered steps with the exact words of the screens. The POS and
 * the KDS precache it, so it opens on the tablet without internet.
 */
export default async function ManualPage({ params }: { params: Params }) {
  const { lang, role } = await params;
  if (!isHelpLanguage(lang) || !isHelpRole(role)) notFound();
  const manual = MANUALS[lang][role];
  const chrome = HELP_CHROME[lang];
  return (
    <HelpShell lang={lang} role={role}>
      <article className="grid gap-6" data-testid="manual">
        <div className="grid gap-2">
          <h2 className="text-xl font-semibold">{manual.title}</h2>
          <p className="text-muted-foreground">{manual.intro}</p>
        </div>
        {manual.sections.map((section) => (
          <section key={section.title} className="grid gap-3 break-inside-avoid">
            <h3 className="text-lg font-semibold">{section.title}</h3>
            <ol className="ml-6 grid list-decimal gap-2 leading-relaxed">
              {section.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            {section.tip ? (
              <Alert>
                <strong>{chrome.tip}:</strong> {section.tip}
              </Alert>
            ) : null}
          </section>
        ))}
      </article>
    </HelpShell>
  );
}
