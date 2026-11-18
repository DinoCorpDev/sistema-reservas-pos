import { cn } from '@pos/ui/utils';

/**
 * The Zitas symbol (brandbook V3.0, DEC-049): the Z that connects, the teal dot that confirms.
 * Drawn as a vector, so it stays sharp at any size; it takes the text color, the dot stays teal.
 */
export function ZitasMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={cn('size-8 shrink-0', className)}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <path
        d="M17 21 H70 L21 79 H62"
        fill="none"
        stroke="currentColor"
        strokeWidth="15"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="82" cy="79" r="9.5" fill="var(--brand, #20b8bd)" />
    </svg>
  );
}

/**
 * The horizontal logo: symbol and «zitas» wordmark in Chakra Petch, with «POS» beside it as the
 * product's name (outside the logo's safe area, never inside it).
 */
export function ZitasLogo({
  className,
  size = 'md',
  product = true,
}: {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  product?: boolean;
}) {
  const sizes = {
    sm: { mark: 'size-6', word: 'text-xl', product: 'text-[0.6rem] px-1.5 py-0.5' },
    md: { mark: 'size-8', word: 'text-2xl', product: 'text-xs px-2 py-0.5' },
    lg: { mark: 'size-14', word: 'text-5xl', product: 'text-sm px-2.5 py-1' },
  }[size];
  return (
    // Decorative: where it names the page, the caller adds the name for screen readers.
    <span aria-hidden className={cn('inline-flex items-center gap-2', className)}>
      <ZitasMark className={sizes.mark} />
      <span className={cn('font-brand leading-none font-semibold tracking-tight', sizes.word)}>
        zitas
      </span>
      {product ? (
        <span
          className={cn(
            'ml-1 rounded-full bg-brand-soft font-brand font-semibold tracking-wider text-brand-strong uppercase',
            sizes.product,
          )}
        >
          POS
        </span>
      ) : null}
    </span>
  );
}
