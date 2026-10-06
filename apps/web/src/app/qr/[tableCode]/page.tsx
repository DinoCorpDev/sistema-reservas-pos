import type { Metadata } from 'next';
import { ModulePlaceholder } from '@/components/module-placeholder';

export const metadata: Metadata = { title: 'Menü' };

export default async function QrMenuPage({ params }: { params: Promise<{ tableCode: string }> }) {
  const { tableCode } = await params;
  return (
    <ModulePlaceholder
      title="Menü"
      subtitle={`Digitale Karte für Tisch-Code ${tableCode}, in der Sprache des Gastes.`}
      phase="Phase 5"
    />
  );
}
