import type { ReactNode } from "react";
import { cn, type IconName } from "@chartermission/ui";

/*
 * Small spot illustrations for empty and end-of-list states. One visual system: a pale
 * navy disc, white cards with navy 2px strokes (like the Figma icon set), grey "text"
 * lines, and the logo's orange dot as the accent. Colours are token classes only
 * (fill-* / stroke-*). Always decorative: the surrounding text carries the meaning.
 */

export type IllustrationName = "quiet" | "caught-up" | "no-results" | "drafts" | "questions" | "bookmarks" | "people";

function Frame({ size, className, children }: { size: number; className?: string; children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 120 96"
      width={size}
      height={(size * 96) / 120}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={cn("shrink-0", className)}
    >
      <ellipse cx="60" cy="87" rx="34" ry="3" className="fill-primary-tint" />
      {children}
    </svg>
  );
}

const Disc = () => <circle cx="60" cy="47" r="38" className="fill-primary-tint-2" />;

/** A quiet feed: two calm cards and a speech bubble waiting to be filled. */
function Quiet() {
  return (
    <>
      <Disc />
      <rect x="28" y="25" width="56" height="40" rx="7" transform="rotate(-6 56 45)" className="fill-card stroke-line-strong" strokeWidth="1.5" />
      <rect x="34" y="32" width="56" height="42" rx="7" className="fill-card stroke-primary" strokeWidth="2" />
      <circle cx="45" cy="44" r="5" className="fill-primary-tint" />
      <path d="M55 42h22" className="stroke-primary" strokeWidth="2" />
      <path d="M55 48h14" className="stroke-line-strong" strokeWidth="2" />
      <path d="M42 58h40M42 64h28" className="stroke-line-strong" strokeWidth="2" />
      <path d="M86 14h12a8 8 0 0 1 0 16h-6l-5 4v-4h-1a8 8 0 0 1 0-16Z" className="fill-card stroke-primary" strokeWidth="2" />
      <circle cx="87" cy="22" r="1.6" className="fill-secondary" />
      <circle cx="92.5" cy="22" r="1.6" className="fill-secondary" />
      <circle cx="98" cy="22" r="1.6" className="fill-accent" />
      <circle cx="22" cy="30" r="2.2" className="fill-accent" />
      <circle cx="102" cy="62" r="1.6" className="fill-warning" />
    </>
  );
}

const SUN = { cx: 60, cy: 62, r: 20 };
const rays = [158, 129, 100, 71, 42].map((deg, index) => {
  const rad = (deg * Math.PI) / 180;
  const inner = SUN.r + 5;
  const outer = SUN.r + (index % 2 ? 9 : 11);
  const point = (d: number) => [SUN.cx + Math.cos(rad) * d, SUN.cy - Math.sin(rad) * d].map((n) => n.toFixed(1)).join(" ");
  return `M${point(inner)}L${point(outer)}`;
});

/** All caught up: the sun rising over the horizon, a check in its face, a small constellation. */
function CaughtUp() {
  const { cx, cy, r } = SUN;
  return (
    <>
      <path d="M22 26l12-9 14 6M76 14l14 9 10-8" className="stroke-primary-light/30" strokeWidth="1" />
      <circle cx="22" cy="26" r="1.8" className="motion-twinkle fill-primary-light" />
      <circle cx="34" cy="17" r="2.2" className="fill-primary-light" />
      <circle cx="48" cy="23" r="1.6" className="motion-twinkle fill-primary-light" style={{ animationDelay: "800ms" }} />
      <circle cx="76" cy="14" r="1.6" className="fill-primary-light" />
      <circle cx="90" cy="23" r="2.4" className="motion-twinkle fill-accent" style={{ animationDelay: "400ms" }} />
      <circle cx="100" cy="15" r="1.6" className="fill-primary-light" />
      <g className="motion-rise">
        <path d={rays.join("")} className="stroke-warning" strokeWidth="2" />
        <path d={`M${cx - r} ${cy}A${r} ${r} 0 0 1 ${cx + r} ${cy}Z`} className="fill-accent-light stroke-accent" strokeWidth="2" />
        <path d="M51.5 54.5l5.5 5.5 11-11" className="stroke-primary" strokeWidth="2.5" />
      </g>
      <path d="M14 62h92" className="stroke-primary" strokeWidth="2" />
      <path d="M28 70h64" className="stroke-line-strong" strokeWidth="2" />
      <path d="M44 77h32" className="stroke-line" strokeWidth="2" />
    </>
  );
}

/** No results: a magnifier over an empty, dashed card, with two filter chips set aside. */
function NoResults() {
  return (
    <>
      <Disc />
      <rect x="28" y="40" width="58" height="36" rx="7" className="fill-card stroke-line-strong" strokeWidth="2" strokeDasharray="4 5" />
      <rect x="16" y="20" width="26" height="9" rx="4.5" className="fill-primary-tint" />
      <rect x="22" y="31" width="18" height="9" rx="4.5" className="fill-accent-light" />
      <circle cx="74" cy="38" r="14" className="fill-card stroke-primary" strokeWidth="2.5" />
      <path d="M68 38h12" className="stroke-line-strong" strokeWidth="2" />
      <path d="M84.5 48.5l10 10" className="stroke-primary" strokeWidth="4" />
      <circle cx="100" cy="24" r="2.2" className="fill-accent" />
      <circle cx="20" cy="66" r="1.6" className="fill-warning" />
    </>
  );
}

/** No drafts: a blank sheet, a pencil, and a paper plane that has already gone. */
function Drafts() {
  return (
    <>
      <Disc />
      <rect x="34" y="20" width="44" height="56" rx="6" className="fill-card stroke-primary" strokeWidth="2" />
      <path d="M42 32h24" className="stroke-primary" strokeWidth="2" />
      <path d="M42 40h28M42 48h22" className="stroke-line-strong" strokeWidth="2" />
      <path d="M42 56h14" className="stroke-line-strong" strokeWidth="2" strokeDasharray="2 4" />
      <path d="M74 66l17-17" className="stroke-accent" strokeWidth="5" />
      <path d="M70.5 69.5l2-5 3 3-5 2Z" className="fill-primary stroke-primary" strokeWidth="1.5" />
      <path d="M90 50l3-3" className="stroke-primary" strokeWidth="5" />
      <path d="M66 24c8-8 14-10 22-8" className="stroke-line-strong" strokeWidth="1.5" strokeDasharray="2 4" />
      <path d="M90 14l16-5-6 15-3.5-5.5L90 14Z" className="fill-card stroke-primary-light" strokeWidth="1.75" />
      <circle cx="22" cy="40" r="2.2" className="fill-accent" />
    </>
  );
}

/** No questions: a question in a bubble, an answer bubble, and a small idea glowing. */
function Questions() {
  return (
    <>
      <Disc />
      <path d="M38 22h28a12 12 0 0 1 12 12v14a12 12 0 0 1-12 12H48l-10 9v-9a12 12 0 0 1-12-12V34a12 12 0 0 1 12-12Z" className="fill-card stroke-primary" strokeWidth="2" />
      <path d="M46.5 36.5a5.5 5.5 0 1 1 7.6 5.1c-1.4.6-2.1 1.6-2.1 3.1v1.3" className="stroke-accent" strokeWidth="2.5" />
      <circle cx="52" cy="52" r="1.7" className="fill-accent" />
      <rect x="70" y="50" width="32" height="20" rx="10" className="fill-primary-tint stroke-primary-light" strokeWidth="1.5" />
      <circle cx="79" cy="60" r="1.6" className="fill-primary-light" />
      <circle cx="86" cy="60" r="1.6" className="fill-primary-light" />
      <circle cx="93" cy="60" r="1.6" className="fill-primary-light" />
      <circle cx="94" cy="26" r="5" className="fill-warning-light stroke-warning" strokeWidth="1.5" />
      <path d="M94 15v3M103 19l-2 2M105 28h-3M85 19l2 2" className="stroke-warning" strokeWidth="1.5" />
    </>
  );
}

/** No bookmarks: a card with a ribbon waiting at its corner. */
function Bookmarks() {
  return (
    <>
      <Disc />
      <rect x="28" y="30" width="60" height="44" rx="7" className="fill-card stroke-primary" strokeWidth="2" />
      <path d="M36 44h22" className="stroke-primary" strokeWidth="2" />
      <path d="M36 52h36M36 60h26" className="stroke-line-strong" strokeWidth="2" />
      <path d="M68 24h14v30l-7-5-7 5V24Z" className="fill-accent-light stroke-accent" strokeWidth="2" />
      <path d="M98 16l1.6 4.4L104 22l-4.4 1.6L98 28l-1.6-4.4L92 22l4.4-1.6Z" className="fill-warning" />
      <circle cx="20" cy="58" r="1.6" className="fill-primary-light" />
    </>
  );
}

/** People: three members joined by a constellation, with the orange dot as "you". */
function People() {
  const member = (cx: number, cy: number, r: number) => (
    <g>
      <circle cx={cx} cy={cy} r={r} className="fill-card stroke-primary" strokeWidth="2" />
      <circle cx={cx} cy={cy - r * 0.22} r={r * 0.3} className="fill-primary-tint" />
      <path d={`M${cx - r * 0.5} ${cy + r * 0.55}a${r * 0.5} ${r * 0.42} 0 0 1 ${r} 0`} className="fill-primary-tint" />
    </g>
  );
  return (
    <>
      <Disc />
      <path d="M48 58L60 40l12 18M50 62h20" className="stroke-line-strong" strokeWidth="1.5" strokeDasharray="2 4" />
      {member(60, 34, 12)}
      {member(40, 60, 10)}
      {member(80, 60, 10)}
      <circle cx="60" cy="66" r="3.2" className="fill-accent" />
      <circle cx="89" cy="50" r="5.5" className="fill-accent" />
      <path d="M89 47.5v5M86.5 50h5" className="stroke-inverse" strokeWidth="1.6" />
      <circle cx="22" cy="30" r="1.8" className="fill-warning" />
    </>
  );
}

const art: Record<IllustrationName, () => ReactNode> = {
  quiet: Quiet,
  "caught-up": CaughtUp,
  "no-results": NoResults,
  drafts: Drafts,
  questions: Questions,
  bookmarks: Bookmarks,
  people: People,
};

/** A spot illustration (decorative, aria-hidden). `size` is the width in px; height is 4/5 of it. */
export function Illustration({ name, size = 120, className }: { name: IllustrationName; size?: number; className?: string }) {
  const Art = art[name];
  return (
    <Frame size={size} className={className}>
      <Art />
    </Frame>
  );
}

/** Sensible illustration for an EmptyState icon, if there is one. */
export const illustrationForIcon: Partial<Record<IconName, IllustrationName>> = {
  home: "quiet",
  message: "quiet",
  hash: "quiet",
  filter: "no-results",
  search: "no-results",
  send: "drafts",
  clock: "drafts",
  bookmark: "bookmarks",
  users: "people",
  user: "people",
  lightbulb: "questions",
  check: "caught-up",
};
