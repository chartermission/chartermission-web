import { cn } from "../cn";

type Theme = "light" | "dark";

/** Logo mark, copied from the Figma SVG export (Logo, node 7:24). */
export function LogoMark({ theme = "light", size = 32, className }: { theme?: Theme; size?: number; className?: string }) {
  const tile = theme === "light" ? "#233465" : "#FFFFFF";
  const arc = theme === "light" ? "white" : "#233465";
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" className={cn("shrink-0", className)}>
      <path
        d="M24 0H8C3.58172 0 0 3.58172 0 8V24C0 28.4183 3.58172 32 8 32H24C28.4183 32 32 28.4183 32 24V8C32 3.58172 28.4183 0 24 0Z"
        fill={tile}
      />
      <path
        d="M21.6001 10.8C20.5575 9.68873 19.2049 8.91652 17.718 8.58361C16.231 8.25069 14.6783 8.37244 13.2614 8.93305C11.8445 9.49367 10.6288 10.4673 9.7722 11.7274C8.91556 12.9876 8.45752 14.4762 8.45752 16C8.45752 17.5238 8.91556 19.0124 9.7722 20.2726C10.6288 21.5327 11.8445 22.5063 13.2614 23.0669C14.6783 23.6276 16.231 23.7493 17.718 23.4164C19.2049 23.0835 20.5575 22.3113 21.6001 21.2"
        stroke={arc}
        strokeWidth="3.2"
        strokeLinecap="round"
      />
      <path
        d="M22.7999 18.6C24.2359 18.6 25.4 17.4359 25.4 16C25.4 14.5641 24.2359 13.4 22.7999 13.4C21.364 13.4 20.2 14.5641 20.2 16C20.2 17.4359 21.364 18.6 22.7999 18.6Z"
        fill="#E94E1D"
      />
    </svg>
  );
}

/** Mark + "Charter Mission" wordmark (H3, 18/26 semibold). */
export function Logo({ theme = "light", className }: { theme?: Theme; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-[10px]", className)}>
      <LogoMark theme={theme} />
      <span className="inline-flex gap-1 text-h3 whitespace-nowrap">
        <span className={theme === "light" ? "text-primary" : "text-inverse"}>Charter</span>
        <span className="text-accent">Mission</span>
      </span>
    </span>
  );
}
