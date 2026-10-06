import type { Metadata } from 'next';
import { ModulePlaceholder } from '@/components/module-placeholder';

export const metadata: Metadata = { title: 'Backoffice' };

export default function BackofficePage() {
  return (
    <ModulePlaceholder
      title="Backoffice"
      subtitle="Standorte, Katalog, MWST, Benutzer und Einrichtungs-Checkliste."
      phase="Phase 1"
    />
  );
}
