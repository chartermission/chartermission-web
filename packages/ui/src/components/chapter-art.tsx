import { useId } from "react";
import { cn } from "../cn";
import { AFRICA_MAP_SRC } from "./africa-map";
import { flagColours } from "./flag-colours";

/*
 * Generated chapter artwork, kept deliberately quiet: the display picture is the country code over
 * a stripe in the flag's colours, and the cover is a photograph of the country (or, where there is
 * none yet, the Africa map with the country pinned) with the same stripe along its foot. Neither
 * carries wording: the chapter's name is always printed beside them, in the reader's language.
 * Uploaded pictures (imageUrl / coverUrl) replace the generated art.
 */

const GREEN_DEEP = "#024A22";
const ORANGE = "#FF9A1F";
/** Pale backdrop behind generated art: light enough to sit on a white page header. */
const PAPER = "#EEF4F0";
const PAPER_LINE = "#D9E6DE";

/** "Nigeria Chapter" → "Nigeria", "UK Diaspora Chapter" → "UK Diaspora". */
export function chapterLabel(name: string): string {
  return name.replace(/\s+chapter$/i, "").trim() || name;
}

/** Brand stripe (Figma "Brand stripe"): equal segments, here in the country's flag colours. */
function FlagStripe({ colours, x, y, width, height, rounded = 0 }: { colours: string[]; x: number; y: number; width: number; height: number; rounded?: number }) {
  const w = width / colours.length;
  const clip = useId();
  return (
    <g>
      <defs>
        <clipPath id={clip}>
          <rect x={x} y={y} width={width} height={height} rx={rounded} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        {colours.map((c, i) => (
          <rect key={i} x={x + i * w} y={y} width={w + 0.5} height={height} fill={c} />
        ))}
      </g>
      {/* A hairline keeps white segments visible on light backgrounds. */}
      <rect x={x + 0.5} y={y + 0.5} width={width - 1} height={height - 1} rx={rounded} fill="none" stroke="#000" strokeOpacity="0.12" />
    </g>
  );
}

/**
 * Chapter display picture (800 × 800 design, square): the country code over the flag stripe on a
 * pale tile. Show it in a circle or rounded tile with `className` (e.g. "rounded-full").
 */
export function ChapterAvatar({
  countryCode,
  src,
  size = 48,
  className,
  title,
}: {
  name: string;
  countryCode: string;
  /** Uploaded picture; replaces the generated design. */
  src?: string | null;
  size?: number;
  className?: string;
  /** Accessible name; omit for decorative use next to the chapter name. */
  title?: string;
}) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- permission-checked API media
      <img src={src} alt={title ?? ""} width={size} height={size} className={cn("shrink-0 object-cover", className)} />
    );
  }
  const colours = flagColours(countryCode);
  return (
    <svg
      viewBox="0 0 800 800"
      width={size}
      height={size}
      direction="ltr"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={cn("shrink-0", className)}
    >
      {title && <title>{title}</title>}
      <rect width="800" height="800" fill={PAPER} />
      <text
        x="400"
        y="455"
        textAnchor="middle"
        fontFamily="Inter, 'Inter Variable', system-ui, sans-serif"
        fontSize="290"
        fontWeight="800"
        fill={GREEN_DEEP}
        letterSpacing="-0.02em"
      >
        {countryCode.toUpperCase()}
      </text>
      <FlagStripe colours={colours} x={220} y={540} width={360} height={56} rounded={28} />
    </svg>
  );
}

/** Approximate country centres (lat, lon) for the pin on the cover's Africa map. */
const CENTRES: Record<string, [number, number]> = {
  DZ: [28, 2.6], AO: [-12.3, 17.5], BJ: [9.3, 2.3], BW: [-22.3, 24.7], BF: [12.2, -1.6], BI: [-3.4, 29.9],
  CV: [16, -23.6], CM: [5.7, 12.7], CF: [6.6, 20.9], TD: [15.4, 18.7], KM: [-11.9, 43.9], CG: [-0.7, 15.2],
  CD: [-2.9, 23.6], CI: [7.5, -5.5], DJ: [11.8, 42.6], EG: [26.8, 30.8], GQ: [1.6, 10.3], ER: [15.2, 39.8],
  SZ: [-26.5, 31.5], ET: [9.1, 40.5], GA: [-0.8, 11.6], GM: [13.4, -15.3], GH: [7.9, -1.0], GN: [9.9, -9.7],
  GW: [11.8, -15.2], KE: [0.0, 37.9], LS: [-29.6, 28.2], LR: [6.4, -9.4], LY: [26.3, 17.2], MG: [-18.8, 46.9],
  MW: [-13.3, 34.3], ML: [17.6, -4.0], MR: [21.0, -10.9], MU: [-20.3, 57.6], MA: [31.8, -7.1], MZ: [-18.7, 35.5],
  NA: [-22.9, 18.5], NE: [17.6, 8.1], NG: [9.1, 8.7], RW: [-1.9, 29.9], ST: [0.2, 6.6], SN: [14.5, -14.5],
  SC: [-4.7, 55.5], SL: [8.5, -11.8], SO: [5.2, 46.2], ZA: [-30.6, 22.9], SS: [6.9, 31.3], SD: [12.9, 30.2],
  TZ: [-6.4, 34.9], TG: [8.6, 0.8], TN: [33.9, 9.5], UG: [1.4, 32.3], ZM: [-13.1, 27.8], ZW: [-19.0, 29.2],
  EH: [24.2, -12.9], RE: [-21.1, 55.5], YT: [-12.8, 45.2],
};

/** Map box for the cover (Africa map PNG 128 × 138, spanning roughly 17.5°W–51.5°E, 37.5°N–35°S). */
const MAP = { x: 652, y: 28, w: 296, h: 320 };
function pin(code: string): { x: number; y: number } | null {
  const c = CENTRES[code.toUpperCase()];
  if (!c) return null;
  const fx = Math.min(0.97, Math.max(0.03, (c[1] + 17.5) / 69));
  const fy = Math.min(0.97, Math.max(0.03, (37.5 - c[0]) / 72.5));
  return { x: MAP.x + fx * MAP.w, y: MAP.y + fy * MAP.h };
}

/**
 * Sized address for a chapter photograph. Unsplash serves any width from the same address, so
 * the browser gets a file that fits the cover instead of the multi-megabyte original.
 */
export function chapterPhotoSrc(url: string, width = 1600): string {
  if (!/^https:\/\/images\.unsplash\.com\//.test(url)) return url;
  return `${url.split("?")[0]}?auto=format&fit=crop&w=${width}&h=${Math.round(width / 4)}&q=70`;
}

/**
 * Chapter page cover (1600 × 400 design, 4:1). With a photograph: the photograph, a soft shade at
 * its foot and the flag stripe. Without one: the Africa network map on a pale ground, with the
 * chapter's country pinned (diaspora chapters show the map unpinned).
 */
export function ChapterCover({
  name,
  countryCode,
  src,
  photo,
  className,
}: {
  name: string;
  countryCode: string;
  src?: string | null;
  /** A photograph of the country, shown as it is. */
  photo?: { url: string; credit?: string | null } | null;
  className?: string;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- permission-checked API media
    return <img src={src} alt="" className={cn("h-full w-full object-cover", className)} />;
  }
  const colours = flagColours(countryCode);
  if (photo) {
    return (
      <svg viewBox="0 0 1600 400" preserveAspectRatio="xMidYMid slice" direction="ltr" aria-hidden="true" className={cn("block h-full w-full", className)}>
        <defs>
          <linearGradient id={`${uid}-shade`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0.55" stopColor="#000000" stopOpacity="0" />
            <stop offset="1" stopColor="#000000" stopOpacity="0.35" />
          </linearGradient>
        </defs>
        <rect width="1600" height="400" fill={PAPER} />
        <image href={chapterPhotoSrc(photo.url)} x="0" y="0" width="1600" height="400" preserveAspectRatio="xMidYMid slice" />
        <rect width="1600" height="400" fill={`url(#${uid}-shade)`} />
        <FlagStripe colours={colours} x={0} y={388} width={1600} height={12} />
      </svg>
    );
  }
  const diaspora = /diaspora/i.test(chapterLabel(name));
  const p = diaspora ? null : pin(countryCode);
  return (
    <svg viewBox="0 0 1600 400" preserveAspectRatio="xMidYMid slice" direction="ltr" aria-hidden="true" className={cn("block h-full w-full", className)}>
      <defs>
        <filter id={`${uid}-lift`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="10" stdDeviation="14" floodColor={GREEN_DEEP} floodOpacity="0.2" />
        </filter>
      </defs>
      <rect width="1600" height="400" fill={PAPER} />
      {[150, 260, 380, 520].map((r) => (
        <circle key={r} cx="800" cy="190" r={r} fill="none" stroke={PAPER_LINE} strokeWidth="2" />
      ))}
      <image href={AFRICA_MAP_SRC} x={MAP.x} y={MAP.y} width={MAP.w} height={MAP.h} preserveAspectRatio="xMidYMid meet" filter={`url(#${uid}-lift)`} />
      {p && (
        <g>
          <circle cx={p.x} cy={p.y} r="22" fill={ORANGE} opacity="0.25" />
          <circle cx={p.x} cy={p.y} r="11" fill={ORANGE} stroke="#FFFFFF" strokeWidth="3" />
        </g>
      )}
      <FlagStripe colours={colours} x={0} y={388} width={1600} height={12} />
    </svg>
  );
}
