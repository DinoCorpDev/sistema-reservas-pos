import type { Metadata } from 'next';
import { ModulePlaceholder } from '@/components/module-placeholder';

export const metadata: Metadata = { title: 'Küche' };

export default function KdsPage() {
  return (
    <ModulePlaceholder
      title="Küche (KDS)"
      subtitle="Bons pro Station mit Zeiten, Allergenen und Status."
      phase="Phase 3"
    />
  );
}
