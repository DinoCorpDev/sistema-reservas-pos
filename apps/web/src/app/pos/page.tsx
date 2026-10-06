import type { Metadata } from 'next';
import { ModulePlaceholder } from '@/components/module-placeholder';

export const metadata: Metadata = { title: 'Kasse' };

export default function PosPage() {
  return (
    <ModulePlaceholder
      title="Kasse & Service"
      subtitle="Tischplan, Bestellungen und Zahlung, offline-fähig."
      phase="Phase 2"
    />
  );
}
