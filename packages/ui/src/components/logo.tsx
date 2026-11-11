import { useId } from "react";
import { cn } from "../cn";
import { AFRICA_MAP_SRC } from "./africa-map";

type Theme = "light" | "dark";

/**
 * Logo mark (Figma Logo, node 7:24): green gradient tile, red-to-orange C, white Africa network
 * map inside the C. The dark theme keeps the same tile with a soft white outline for green surfaces.
 */
export function LogoMark({ theme = "light", size = 32, className }: { theme?: Theme; size?: number; className?: string }) {
  // Unique per mark: with shared ids, a hidden logo elsewhere on the page (display:none) would own the
  // gradients and this one would render without its tile and C.
  const id = useId().replace(/:/g, "");
  const tile = `cm-logo-tile-${id}`;
  const arc = `cm-logo-arc-${id}`;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" className={cn("shrink-0", className)}>
      <defs>
        <linearGradient id={tile} x1="28" y1="2" x2="4" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#067239" />
          <stop offset="1" stopColor="#024A22" />
        </linearGradient>
        <linearGradient id={arc} x1="6.8" y1="16" x2="24" y2="16" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ED0918" />
          <stop offset="0.55" stopColor="#FF3A12" />
          <stop offset="1" stopColor="#FF8A00" />
        </linearGradient>
      </defs>
      <path
        d="M24 0H8C3.58172 0 0 3.58172 0 8V24C0 28.4183 3.58172 32 8 32H24C28.4183 32 32 28.4183 32 24V8C32 3.58172 28.4183 0 24 0Z"
        fill={`url(#${tile})`}
      />
      {theme === "dark" && (
        <path
          d="M24 0.5H8C3.85786 0.5 0.5 3.85786 0.5 8V24C0.5 28.1421 3.85786 31.5 8 31.5H24C28.1421 31.5 31.5 28.1421 31.5 24V8C31.5 3.85786 28.1421 0.5 24 0.5Z"
          stroke="white"
          strokeOpacity="0.35"
        />
      )}
      <image href={AFRICA_MAP_SRC} x="10.55" y="9.36" width="12.809" height="13.8" preserveAspectRatio="xMidYMid meet" />
      <path
        d="M23.962 9.282C21.276 6.224 16.980 5.145 13.168 6.571C9.356 7.996 6.821 11.629 6.800 15.699C6.779 19.768 9.275 23.428 13.072 24.893C16.869 26.358 21.176 25.324 23.894 22.295"
        stroke={`url(#${arc})`}
        strokeWidth="3.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Mark + "Charter Mission" wordmark (H3, 18/26 semibold). */
export function Logo({ theme = "light", className }: { theme?: Theme; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-[10px]", className)}>
      <LogoMark theme={theme} />
      <span dir="ltr" className="inline-flex gap-1 text-h3 whitespace-nowrap">
        <span className={theme === "light" ? "text-primary" : "text-inverse"}>Charter</span>
        <span className={theme === "light" ? "text-accent" : "text-accent-on-dark"}>Mission</span>
      </span>
    </span>
  );
}
