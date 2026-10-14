'use client';

import { Button } from '@pos/ui/button';
import { PrinterIcon } from 'lucide-react';

/** Prints the page; the browser's print dialog also saves it as PDF (RF-D16, RF-F03). */
export function PrintButton({ label }: { label: string }) {
  return (
    <Button variant="outline" className="print:hidden" onClick={() => window.print()}>
      <PrinterIcon /> {label}
    </Button>
  );
}
