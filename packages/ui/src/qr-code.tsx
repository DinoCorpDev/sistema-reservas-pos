import { useMemo } from 'react';
import { encode } from 'uqr';
import { cn } from './utils';

/**
 * QR code drawn on the device itself (no network, no server): black on white whatever the theme,
 * so any phone camera reads it. `value` is usually a URL.
 */
export function QrCode({
  value,
  label,
  className,
}: {
  value: string;
  /** What the QR opens, for screen readers. */
  label: string;
  className?: string;
}) {
  const { size, path } = useMemo(() => {
    const { data } = encode(value, { ecc: 'M', border: 2 });
    let d = '';
    data.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) d += `M${x} ${y}h1v1h-1z`;
      }),
    );
    return { size: data.length, path: d };
  }, [value]);

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      className={cn('aspect-square rounded-md bg-white', className)}
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
