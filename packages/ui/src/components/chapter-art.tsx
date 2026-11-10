import { useId } from "react";
import { cn } from "../cn";
import { AFRICA_MAP_SRC } from "./africa-map";
import { flagColours } from "./flag-colours";

/*
 * Generated chapter artwork, from Figma "Brand Kit / 02 · Profile pictures / Avatar · Chapter"
 * (green tile, deco rings, logo mark, country name, "Chapter" in orange). Each chapter gets its own
 * accent: the brand stripe in the country's flag colours, and on the cover a pin on the Africa map.
 * Uploaded pictures (imageUrl / coverUrl) replace the generated art.
 */

const GREEN = "#046D35";
const GREEN_DEEP = "#024A22";
const GREEN_LIGHT = "#0A8A47";
const ORANGE = "#FF9A1F";

/** "Nigeria Chapter" → "Nigeria", "UK Diaspora Chapter" → "UK Diaspora". */
export function chapterLabel(name: string): string {
  return name.replace(/\s+chapter$/i, "").trim() || name;
}

/** One or two lines for the name, balanced at a space for long names. */
function nameLines(label: string, maxOneLine: number): string[] {
  if (label.length <= maxOneLine || !label.includes(" ")) return [label];
  const words = label.split(" ");
  let best: [string, string] = [label, ""];
  let bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ");
    const b = words.slice(i).join(" ");
    const diff = Math.abs(a.length - b.length);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = [a, b];
    }
  }
  return best;
}

/** Font size so the longest line fits `width` (Inter Bold ≈ 0.6 em per character). */
const fit = (lines: string[], width: number, max: number) => Math.min(max, Math.floor(width / (Math.max(...lines.map((l) => l.length)) * 0.6)));

/** The logo mark (tile, C and Africa map) at the given box, for use inside other SVGs. */
function MarkArt({ x, y, size, uid }: { x: number; y: number; size: number; uid: string }) {
  return (
    <svg x={x} y={y} width={size} height={size} viewBox="0 0 32 32" fill="none">
      <defs>
        <linearGradient id={`${uid}-tile`} x1="28" y1="2" x2="4" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#067239" />
          <stop offset="1" stopColor={GREEN_DEEP} />
        </linearGradient>
        <linearGradient id={`${uid}-arc`} x1="6.8" y1="16" x2="24" y2="16" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ED0918" />
          <stop offset="0.55" stopColor="#FF3A12" />
          <stop offset="1" stopColor="#FF8A00" />
        </linearGradient>
      </defs>
      <path
        d="M24 0H8C3.58172 0 0 3.58172 0 8V24C0 28.4183 3.58172 32 8 32H24C28.4183 32 32 28.4183 32 24V8C32 3.58172 28.4183 0 24 0Z"
        fill={`url(#${uid}-tile)`}
      />
      <path
        d="M24 0.5H8C3.85786 0.5 0.5 3.85786 0.5 8V24C0.5 28.1421 3.85786 31.5 8 31.5H24C28.1421 31.5 31.5 28.1421 31.5 24V8C31.5 3.85786 28.1421 0.5 24 0.5Z"
        stroke="white"
        strokeOpacity="0.35"
      />
      <image href={AFRICA_MAP_SRC} x="10.55" y="9.36" width="12.809" height="13.8" preserveAspectRatio="xMidYMid meet" />
      <path
        d="M23.962 9.282C21.276 6.224 16.980 5.145 13.168 6.571C9.356 7.996 6.821 11.629 6.800 15.699C6.779 19.768 9.275 23.428 13.072 24.893C16.869 26.358 21.176 25.324 23.894 22.295"
        stroke={`url(#${uid}-arc)`}
        strokeWidth="3.3"
        strokeLinecap="round"
      />
    </svg>
  );
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
 * Chapter display picture (800 × 800 design, square). Show it in a circle or rounded tile with
 * `className` (e.g. "rounded-full"); everything important sits inside the central 640 px.
 */
export function ChapterAvatar({
  name,
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
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- permission-checked API media
      <img src={src} alt={title ?? ""} width={size} height={size} className={cn("shrink-0 object-cover", className)} />
    );
  }
  const label = chapterLabel(name);
  // Below 72 px the name can't be read: show the country code large instead (same tile, stripe and rings).
  if (size < 72) {
    const colours = flagColours(countryCode);
    return (
      <svg
        viewBox="0 0 800 800"
        width={size}
        height={size}
        role={title ? "img" : undefined}
        aria-label={title}
        aria-hidden={title ? undefined : true}
        className={cn("shrink-0", className)}
      >
        {title && <title>{title}</title>}
        <rect width="800" height="800" fill={GREEN} />
        <circle cx="640" cy="120" r="160" fill="none" stroke={GREEN_LIGHT} strokeOpacity="0.7" strokeWidth="14" />
        <circle cx="640" cy="120" r="300" fill="none" stroke={GREEN_LIGHT} strokeOpacity="0.7" strokeWidth="14" />
        <text
          x="400"
          y="475"
          textAnchor="middle"
          fontFamily="Inter, 'Inter Variable', system-ui, sans-serif"
          fontSize="300"
          fontWeight="800"
          fill="#FFFFFF"
          letterSpacing="-0.02em"
        >
          {countryCode.toUpperCase()}
        </text>
        <FlagStripe colours={colours} x={220} y={560} width={360} height={56} rounded={28} />
      </svg>
    );
  }
  const lines = nameLines(label, 12);
  const font = fit(lines, 560, lines.length > 1 ? 68 : 84);
  const colours = flagColours(countryCode);
  const nameTop = 448;
  const lineGap = font * 1.08;
  const chapterY = nameTop + font * 0.82 + (lines.length - 1) * lineGap + 70;
  return (
    <svg
      viewBox="0 0 800 800"
      width={size}
      height={size}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={cn("shrink-0", className)}
    >
      {title && <title>{title}</title>}
      <rect width="800" height="800" fill={GREEN} />
      <circle cx="640" cy="120" r="160" fill="none" stroke={GREEN_LIGHT} strokeOpacity="0.6" strokeWidth="3" />
      <circle cx="640" cy="120" r="300" fill="none" stroke={GREEN_LIGHT} strokeOpacity="0.6" strokeWidth="3" />
      <MarkArt x={300} y={lines.length > 1 ? 170 : 207.5} size={200} uid={uid} />
      <g fontFamily="Inter, 'Inter Variable', system-ui, sans-serif" textAnchor="middle">
        {lines.map((line, i) => (
          <text
            key={i}
            x="400"
            y={(lines.length > 1 ? nameTop - 38 : nameTop) + font * 0.82 + i * lineGap}
            fontSize={font}
            fontWeight="700"
            fill="#FFFFFF"
            letterSpacing="-0.01em"
          >
            {line}
          </text>
        ))}
        <text x="400" y={lines.length > 1 ? chapterY - 38 : chapterY} fontSize="44" fontWeight="600" fill={ORANGE}>
          Chapter
        </text>
      </g>
      <FlagStripe colours={colours} x={280} y={lines.length > 1 ? chapterY - 4 : chapterY + 34} width={240} height={16} rounded={8} />
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
const MAP = { x: 1150, y: 40, w: 296, h: 320 };
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

/** The cover with a country photograph: photo, green wash from the reading side, title and flag stripe. */
function PhotoCover({ name, countryCode, photo, className }: { name: string; countryCode: string; photo: { url: string; credit?: string | null }; className?: string }) {
  const label = chapterLabel(name);
  const diaspora = /diaspora/i.test(label);
  const place = label.replace(/\s+diaspora$/i, "");
  const colours = flagColours(countryCode);
  const headSize = Math.min(64, Math.floor(1000 / (`Find your people in ${place}`.length * 0.56)));
  const wash = `cover-wash-${countryCode}`;
  return (
    <svg viewBox="0 0 1600 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true" className={cn("block h-full w-full", className)}>
      <defs>
        <linearGradient id={wash} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={GREEN} stopOpacity="0.96" />
          <stop offset="0.45" stopColor={GREEN} stopOpacity="0.82" />
          <stop offset="0.75" stopColor={GREEN} stopOpacity="0.3" />
          <stop offset="1" stopColor={GREEN} stopOpacity="0.1" />
        </linearGradient>
      </defs>
      <rect width="1600" height="400" fill={GREEN} />
      <image href={chapterPhotoSrc(photo.url)} x="0" y="0" width="1600" height="400" preserveAspectRatio="xMidYMid slice" />
      <rect width="1600" height="400" fill={`url(#${wash})`} />
      <g fontFamily="Inter, 'Inter Variable', system-ui, sans-serif">
        <text x="96" y="150" fontSize="22" fontWeight="600" letterSpacing="0.08em" fill="#FFFFFF" fillOpacity="0.85">
          {diaspora ? "CHARTER MISSION · DIASPORA CHAPTER" : "CHARTER MISSION · CHAPTER"}
        </text>
        <text x="96" y={150 + 24 + headSize} fontSize={headSize} fontWeight="700" fill="#FFFFFF" letterSpacing="-0.01em">
          Find your people in <tspan fill={ORANGE}>{place}</tspan>
        </text>
        <text x="96" y={150 + 24 + headSize + 56} fontSize="26" fill="#FFFFFF" fillOpacity="0.9">
          {diaspora ? "Africans abroad, connected to home · chartermission.com" : "Connect, learn and act together · chartermission.com"}
        </text>
      </g>
      <FlagStripe colours={colours} x={0} y={382} width={1600} height={18} />
    </svg>
  );
}

/**
 * Chapter page cover (1600 × 400 design, 4:1): green with deco rings, the Africa network map with
 * the chapter's country pinned (diaspora chapters show the map unpinned), the line "Find your people
 * in {country}" with the country highlighted in orange, and the brand stripe in flag colours.
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
  /** A photograph of the country. It sits behind the title, under a green wash that keeps the text readable. */
  photo?: { url: string; credit?: string | null } | null;
  className?: string;
}) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- permission-checked API media
    return <img src={src} alt="" className={cn("h-full w-full object-cover", className)} />;
  }
  if (photo) return <PhotoCover name={name} countryCode={countryCode} photo={photo} className={className} />;
  const label = chapterLabel(name);
  const diaspora = /diaspora/i.test(label);
  const place = label.replace(/\s+diaspora$/i, "");
  const colours = flagColours(countryCode);
  const p = diaspora ? null : pin(countryCode);
  const headSize = Math.min(64, Math.floor(1000 / ((`Find your people in ${place}`.length) * 0.56)));
  return (
    <svg viewBox="0 0 1600 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true" className={cn("block h-full w-full", className)}>
      <rect width="1600" height="400" fill={GREEN} />
      <circle cx="1460" cy="40" r="130" fill="none" stroke={GREEN_LIGHT} strokeOpacity="0.6" strokeWidth="3" />
      <circle cx="1460" cy="40" r="240" fill="none" stroke={GREEN_LIGHT} strokeOpacity="0.6" strokeWidth="3" />
      <circle cx="1460" cy="40" r="360" fill="none" stroke={GREEN_LIGHT} strokeOpacity="0.6" strokeWidth="3" />
      <image href={AFRICA_MAP_SRC} x={MAP.x} y={MAP.y} width={MAP.w} height={MAP.h} preserveAspectRatio="xMidYMid meet" opacity={p ? 0.9 : 1} />
      {p && (
        <g>
          <circle cx={p.x} cy={p.y} r="22" fill={ORANGE} opacity="0.25" />
          <circle cx={p.x} cy={p.y} r="11" fill={ORANGE} stroke="#FFFFFF" strokeWidth="3" />
        </g>
      )}
      <g fontFamily="Inter, 'Inter Variable', system-ui, sans-serif">
        <text x="96" y="150" fontSize="22" fontWeight="600" letterSpacing="0.08em" fill="#FFFFFF" fillOpacity="0.8">
          {diaspora ? "CHARTER MISSION · DIASPORA CHAPTER" : "CHARTER MISSION · CHAPTER"}
        </text>
        <text x="96" y={150 + 24 + headSize} fontSize={headSize} fontWeight="700" fill="#FFFFFF" letterSpacing="-0.01em">
          Find your people in <tspan fill={ORANGE}>{place}</tspan>
        </text>
        <text x="96" y={150 + 24 + headSize + 56} fontSize="26" fill="#FFFFFF" fillOpacity="0.85">
          {diaspora ? "Africans abroad, connected to home · chartermission.com" : "Connect, learn and act together · chartermission.com"}
        </text>
      </g>
      <FlagStripe colours={colours} x={0} y={382} width={1600} height={18} />
    </svg>
  );
}
