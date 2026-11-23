import { toneByKey } from './category-tone';
import { cn } from './utils';

/** Up to two initials: "Sandra Keller" → "SK", "admin" → "AD". */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
}

/** A person as a round tile with initials, in a colour that stays the same for that person. */
export function Avatar({
  name,
  colorKey,
  size = 'md',
  className,
}: {
  name: string;
  /** What fixes the colour (the user id); the name by default. */
  colorKey?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center rounded-full font-semibold select-none',
        size === 'sm' && 'size-7 text-[11px]',
        size === 'md' && 'size-9 text-xs',
        size === 'lg' && 'size-11 text-sm',
        toneByKey(colorKey ?? name),
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}
