import { redirect } from 'next/navigation';

/** The manuals start in German, the pilot's language (RNF-21). */
export default function HelpIndex() {
  redirect('/help/de');
}
