import type { CSSProperties, ReactNode } from "react";
import { cn } from "@chartermission/ui";

/*
 * Charter Mission brand pattern: a basket weave of short parallel threads (warp and weft
 * alternating cell by cell), interrupted now and then by the logo's open "C" arc with its
 * dot in the mouth. It is drawn as a monochrome mask, so its colour comes from a token
 * (currentColor) and its strength from opacity. 96px tile, 24px cells.
 */
const TILE = 96;
const CELL = 24;
const RINGS = new Set(["1,2", "3,0"]);

function tileSvg(): string {
  const parts: string[] = [];
  for (let row = 0; row < TILE / CELL; row += 1) {
    for (let col = 0; col < TILE / CELL; col += 1) {
      const cx = col * CELL + CELL / 2;
      const cy = row * CELL + CELL / 2;
      if (RINGS.has(`${col},${row}`)) {
        const r = 6.5;
        const a = Math.SQRT1_2 * r;
        parts.push(`<path d='M${cx + a} ${cy - a}A${r} ${r} 0 1 0 ${cx + a} ${cy + a}' fill='none' stroke='black' stroke-width='2' stroke-linecap='round'/>`);
        parts.push(`<circle cx='${cx + r + 0.5}' cy='${cy}' r='1.9' fill='black'/>`);
        continue;
      }
      const horizontal = (col + row) % 2 === 0;
      // Threads run almost the full cell, so neighbouring cells read as one over-under weave.
      for (const offset of [-6, -2, 2, 6]) {
        const [x1, y1, x2, y2] = horizontal ? [cx - 10, cy + offset, cx + 10, cy + offset] : [cx + offset, cy - 10, cx + offset, cy + 10];
        parts.push(`<line x1='${x1}' y1='${y1}' x2='${x2}' y2='${y2}' stroke='black' stroke-width='1' stroke-linecap='round'/>`);
      }
    }
  }
  return `<svg xmlns='http://www.w3.org/2000/svg' width='${TILE}' height='${TILE}' viewBox='0 0 ${TILE} ${TILE}'>${parts.join("")}</svg>`;
}

/** The pattern tile as a CSS url(), for mask-image (draw it with a token colour). */
export const BRAND_PATTERN_URL = `url("data:image/svg+xml,${encodeURIComponent(tileSvg())}")`;

export type PatternFade = "none" | "left" | "right" | "top" | "bottom" | "radial";

const fades: Record<Exclude<PatternFade, "none">, string> = {
  // The pattern is strongest at the named edge and gone well before the opposite one.
  left: "linear-gradient(to right, black, transparent 65%)",
  right: "linear-gradient(to left, black, transparent 65%)",
  top: "linear-gradient(to bottom, black, transparent 75%)",
  bottom: "linear-gradient(to top, black, transparent 75%)",
  radial: "radial-gradient(closest-side, black, transparent)",
};

/**
 * Inline style that paints the brand pattern in `currentColor` on any element
 * (set the colour with a text-* class and the strength with opacity).
 */
export function brandPatternStyle({ fade = "none", size = TILE }: { fade?: PatternFade; size?: number } = {}): CSSProperties {
  const tile = `${size}px ${size}px`;
  if (fade === "none") {
    return {
      backgroundColor: "currentColor",
      maskImage: BRAND_PATTERN_URL,
      maskSize: tile,
      maskRepeat: "repeat",
      WebkitMaskImage: BRAND_PATTERN_URL,
      WebkitMaskSize: tile,
      WebkitMaskRepeat: "repeat",
    };
  }
  const images = `${BRAND_PATTERN_URL}, ${fades[fade]}`;
  return {
    backgroundColor: "currentColor",
    maskImage: images,
    maskSize: `${tile}, 100% 100%`,
    maskRepeat: "repeat, no-repeat",
    maskComposite: "intersect",
    WebkitMaskImage: images,
    WebkitMaskSize: `${tile}, 100% 100%`,
    WebkitMaskRepeat: "repeat, no-repeat",
    WebkitMaskComposite: "source-in",
  };
}

/**
 * Decorative brand pattern layer. Place inside a `relative` (and usually `overflow-hidden`)
 * container, before the content; it is click-through and hidden from assistive tech.
 * Keep it low contrast behind text: the default is primary at 6% opacity.
 */
export function BrandPattern({
  className,
  tone = "text-primary",
  opacity = 0.06,
  fade = "none",
  size,
}: {
  className?: string;
  /** Tailwind text colour class for the pattern, e.g. "text-accent". */
  tone?: string;
  opacity?: number;
  fade?: PatternFade;
  size?: number;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-0", tone, className)}
      style={{ ...brandPatternStyle({ fade, size }), opacity }}
    />
  );
}

/**
 * Patterned placeholder surface, e.g. an article without a cover image. Fills its box
 * (give it a size or aspect ratio); children are centred on top.
 */
export function BrandCover({
  className,
  variant = "tint",
  children,
}: {
  className?: string;
  /** "tint": pale navy surface with a navy pattern. "navy": primary surface with a light pattern. */
  variant?: "tint" | "navy";
  children?: ReactNode;
}) {
  const navy = variant === "navy";
  return (
    <div
      className={cn(
        "relative flex w-full items-center justify-center overflow-hidden",
        navy ? "bg-linear-to-br from-primary to-primary-light text-inverse" : "bg-linear-to-br from-primary-tint-2 to-primary-tint text-primary",
        className,
      )}
    >
      <BrandPattern tone={navy ? "text-inverse" : "text-primary"} opacity={navy ? 0.1 : 0.08} />
      <span aria-hidden="true" className={cn("pointer-events-none absolute -right-10 -bottom-12 size-40 rounded-full border-[14px]", navy ? "border-accent/40" : "border-accent/15")} />
      {children && <div className="relative">{children}</div>}
    </div>
  );
}
