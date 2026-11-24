'use client';

import { cn } from '@pos/ui/utils';
import { type CSSProperties, type ReactNode, useLayoutEffect, useRef, useState } from 'react';

/**
 * The dining room drawn as a room (DEC-057): a floor in perspective, each table with its top, its
 * thickness, a shadow and the chairs around it. Pure CSS 3D, no WebGL: it runs on a modest tablet
 * and without internet. `plan` is the same room seen from above. The POS and the plan editor
 * share it, so a table stands in the same place on both.
 */

export type RoomView = 'plan' | '3d';

/** How far the floor leans back in 3D; enough for depth, little enough to read the tables. */
const TILT_3D = 38;
const ROOM_VIEW_KEY = 'zitas-floor-view';

export function storedRoomView(): RoomView {
  if (typeof window === 'undefined') return '3d';
  return window.localStorage.getItem(ROOM_VIEW_KEY) === 'plan' ? 'plan' : '3d';
}

export function saveRoomView(view: RoomView): void {
  window.localStorage.setItem(ROOM_VIEW_KEY, view);
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * The floor of `cols` × `rows` square cells, laid back in 3D. Children are placed with
 * `roomCell()`; the room passes them the cell size as `--cell`.
 */
export function FloorRoom({
  cols,
  rows,
  view,
  label,
  className,
  children,
}: {
  cols: number;
  rows: number;
  view: RoomView;
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const tilt = view === '3d' ? TILT_3D : 0;
  const cell = width / cols;
  const floorHeight = cell * rows;
  // Seen from the front: the far side recedes, the near side keeps its size (origin at the
  // bottom edge). The stage is as tall as the floor projects, plus room for the tables' height.
  const perspective = Math.max(1000, width * 1.8);
  const radians = (tilt * Math.PI) / 180;
  const projected =
    (floorHeight * Math.cos(radians) * perspective) /
    (perspective + floorHeight * Math.sin(radians));
  return (
    <div
      ref={ref}
      className={cn('relative w-full', className)}
      style={{
        height: width ? projected + (tilt ? 36 : 12) : undefined,
        minHeight: width ? undefined : '20rem',
        perspective: `${perspective}px`,
        perspectiveOrigin: '50% 100%',
        transition: 'height 450ms cubic-bezier(.2,.8,.2,1)',
      }}
    >
      {width > 0 ? (
        <div
          role="group"
          aria-label={label}
          data-view={view}
          className={cn(
            'absolute inset-x-0 bottom-1.5 rounded-[1.5rem]',
            // A warm wooden floor in light, a dark one in dark; a rim like the room's walls.
            'bg-[#efe6d6] shadow-[0_0_0_6px_#ddcfb6,0_24px_48px_-24px_rgb(60_40_20/0.45)] dark:bg-[#24201b] dark:shadow-[0_0_0_6px_#3a3229,0_24px_48px_-24px_rgb(0_0_0/0.7)]',
          )}
          style={
            {
              '--cell': `${cell}px`,
              height: floorHeight,
              transformOrigin: '50% 100%',
              transform: `rotateX(${tilt}deg)`,
              transformStyle: 'preserve-3d',
              transition: 'transform 450ms cubic-bezier(.2,.8,.2,1)',
              // Planks along the room, one line per half cell.
              backgroundImage:
                'repeating-linear-gradient(to bottom, transparent 0, transparent calc(var(--cell) / 2 - 1px), rgb(120 90 50 / 0.12) calc(var(--cell) / 2 - 1px), rgb(120 90 50 / 0.12) calc(var(--cell) / 2))',
            } as CSSProperties
          }
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** Where a table of the plan sits on the floor (percentages of the room). */
export function roomCell(
  box: { posX: number; posY: number; width: number; height: number },
  cols: number,
  rows: number,
): CSSProperties {
  return {
    position: 'absolute',
    left: `${(box.posX / cols) * 100}%`,
    top: `${(box.posY / rows) * 100}%`,
    width: `${(box.width / cols) * 100}%`,
    height: `${(box.height / rows) * 100}%`,
    transformStyle: 'preserve-3d',
  };
}

/** Chair positions around a table, in percent of its cell box: long sides first, then the ends. */
function chairSpots(
  shape: 'rect' | 'round',
  width: number,
  height: number,
  seats: number,
): { x: number; y: number; angle: number }[] {
  const count = Math.max(0, Math.min(seats, 12));
  if (count === 0) return [];
  if (shape === 'round') {
    return Array.from({ length: count }, (_, i) => {
      const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
      return {
        x: 50 + Math.cos(angle) * 41,
        y: 50 + Math.sin(angle) * 41,
        angle: (angle * 180) / Math.PI + 90,
      };
    });
  }
  const horizontal = width >= height;
  const ends = count > 2 && count % 2 === 1 ? 1 : count > 6 ? 2 : 0;
  const perSide = Math.ceil((count - ends) / 2);
  const spots: { x: number; y: number; angle: number }[] = [];
  for (let i = 0; i < perSide; i += 1) {
    const along = ((i + 1) / (perSide + 1)) * 100;
    if (horizontal) {
      spots.push({ x: along, y: 6, angle: 0 });
      if (spots.length < count - ends) spots.push({ x: along, y: 94, angle: 180 });
    } else {
      spots.push({ x: 6, y: along, angle: -90 });
      if (spots.length < count - ends) spots.push({ x: 94, y: along, angle: 90 });
    }
  }
  for (let i = 0; i < ends; i += 1) {
    spots.push(
      horizontal
        ? { x: i === 0 ? 4 : 96, y: 50, angle: i === 0 ? -90 : 90 }
        : { x: 50, y: i === 0 ? 4 : 96, angle: i === 0 ? 0 : 180 },
    );
  }
  return spots;
}

/**
 * One table on the floor: its shadow, chairs, side and top. `topClassName` colours the top
 * (the state on the POS); `children` is what is written on it. `pulse` draws a soft ring around
 * a table that wants attention (food ready).
 */
export function RoomTable({
  shape,
  width,
  height,
  seats,
  topClassName,
  selected,
  pulse,
  children,
}: {
  shape: 'rect' | 'round';
  /** In cells. */
  width: number;
  height: number;
  seats: number;
  topClassName?: string;
  selected?: boolean;
  pulse?: boolean;
  children?: ReactNode;
}) {
  // The table leaves a margin around it for the chairs; a round one is a circle.
  const inset = 'clamp(8px, calc(var(--cell) * 0.13), 26px)';
  const body: CSSProperties =
    shape === 'round'
      ? {
          position: 'absolute',
          aspectRatio: '1',
          height: `calc(min(${height}, ${width}) * var(--cell) - 2 * ${inset})`,
          left: '50%',
          top: '50%',
          translate: '-50% -50%',
          borderRadius: '9999px',
        }
      : { position: 'absolute', inset, borderRadius: 'clamp(8px, calc(var(--cell) * 0.1), 16px)' };
  const chair = 'clamp(11px, calc(var(--cell) * 0.13), 24px)';
  return (
    <span className="pointer-events-none absolute inset-0 [transform-style:preserve-3d]">
      {/* Shadow on the floor, a little ahead of the table. */}
      <span
        aria-hidden
        className="absolute bg-[radial-gradient(closest-side,rgb(60_40_20/0.35),transparent)] dark:bg-[radial-gradient(closest-side,rgb(0_0_0/0.6),transparent)]"
        style={{
          position: 'absolute',
          inset: `calc(${inset} - 6px)`,
          borderRadius: shape === 'round' ? '9999px' : '30%',
          transform: 'translateY(8%)',
        }}
      />
      {pulse ? (
        <span
          aria-hidden
          className="absolute rounded-full bg-emerald-400/40 motion-safe:animate-ping dark:bg-emerald-400/30"
          style={{ ...body, transform: 'translateZ(1px)' }}
        />
      ) : null}
      {chairSpots(shape, width, height, seats).map((spot, index) => (
        <span
          key={index}
          aria-hidden
          className="absolute [transform-style:preserve-3d]"
          style={{
            left: `${spot.x}%`,
            top: `${spot.y}%`,
            width: chair,
            height: chair,
            translate: '-50% -50%',
            rotate: `${spot.angle}deg`,
          }}
        >
          <span
            className="absolute inset-0 rounded-[30%] bg-[#b89f7c] dark:bg-[#5b4b38]"
            style={{ transform: 'translateZ(3px)' }}
          />
          <span
            className="absolute inset-0 rounded-[30%] bg-[#d4bf9d] dark:bg-[#7a664d]"
            style={{ transform: 'translateZ(7px)' }}
          />
          {/* The backrest, on the side away from the table. */}
          <span
            className="absolute inset-x-[8%] top-0 h-[28%] rounded-full bg-[#a88d68] dark:bg-[#4e4030]"
            style={{ transform: 'translateZ(12px)' }}
          />
        </span>
      ))}
      {/* The side of the table, then its top. */}
      <span
        aria-hidden
        className="absolute bg-[#8c7459] dark:bg-[#3f342a]"
        style={{ ...body, transform: 'translateZ(9px)' }}
      />
      <span
        className={cn(
          'pointer-events-auto absolute flex flex-col items-center justify-center overflow-hidden border-2 text-center',
          'transition-[box-shadow] duration-150 group-focus-visible:ring-[4px] group-focus-visible:ring-ring/60',
          selected && 'ring-[4px] ring-brand',
          topClassName ?? 'border-border bg-card text-foreground',
        )}
        style={{ ...body, transform: 'translateZ(16px)' }}
      >
        {children}
      </span>
    </span>
  );
}
