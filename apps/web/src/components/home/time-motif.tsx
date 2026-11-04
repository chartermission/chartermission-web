import { cn } from "@chartermission/ui";
import type { DayPeriod } from "./day-period";

const tile: Record<DayPeriod, string> = {
  morning: "bg-accent-light",
  afternoon: "bg-warning-light",
  evening: "bg-primary-tint",
  night: "bg-primary-tint",
};

const RAYS = [0, 45, 90, 135, 180, 225, 270, 315];

/**
 * Small sun / moon spot that follows the local time of day: a sunrise in the morning, a full
 * sun in the afternoon, a sunset with the first stars in the evening, a crescent at night.
 * Decorative; colours are tokens through currentColor.
 */
export function TimeMotif({ period, className }: { period: DayPeriod | null; className?: string }) {
  return (
    <span aria-hidden="true" className={cn("relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full max-sm:size-10", period ? tile[period] : "bg-muted", className)}>
      {period && (
        <svg viewBox="0 0 48 48" className="size-full">
          {period === "morning" && (
            <>
              <g className="motion-rise text-accent">
                <path d="M14 31a10 10 0 0 1 20 0Z" fill="currentColor" />
                {[-60, -30, 0, 30, 60].map((angle) => (
                  <line key={angle} x1="24" y1="17" x2="24" y2="13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" transform={`rotate(${angle} 24 31)`} />
                ))}
              </g>
              <line x1="9" y1="31.5" x2="39" y2="31.5" className="text-primary-light" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <line x1="15" y1="36" x2="33" y2="36" className="text-primary-light" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
            </>
          )}
          {period === "afternoon" && (
            <g className="motion-rise text-warning">
              <circle cx="24" cy="24" r="7.5" fill="currentColor" />
              {RAYS.map((angle) => (
                <line key={angle} x1="24" y1="11" x2="24" y2="13.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" transform={`rotate(${angle} 24 24)`} />
              ))}
            </g>
          )}
          {period === "evening" && (
            <>
              <g className="motion-rise text-accent-hover">
                <path d="M15 32a9 9 0 0 1 18 0Z" fill="currentColor" />
              </g>
              <line x1="9" y1="32.5" x2="39" y2="32.5" className="text-primary" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <circle cx="14" cy="15" r="1.4" className="motion-twinkle text-primary-light" fill="currentColor" />
              <circle cx="34" cy="13" r="1.1" className="motion-twinkle text-primary-light" fill="currentColor" style={{ animationDelay: "800ms" }} />
            </>
          )}
          {period === "night" && (
            <>
              <path d="M27.5 13.5a10.5 10.5 0 1 0 8 15.6A8.5 8.5 0 0 1 27.5 13.5Z" className="motion-rise text-primary" fill="currentColor" />
              <circle cx="15" cy="15" r="1.4" className="motion-twinkle text-accent" fill="currentColor" />
              <circle cx="36" cy="16" r="1.1" className="motion-twinkle text-primary-light" fill="currentColor" style={{ animationDelay: "700ms" }} />
              <circle cx="13" cy="30" r="1" className="motion-twinkle text-primary-light" fill="currentColor" style={{ animationDelay: "1400ms" }} />
            </>
          )}
        </svg>
      )}
    </span>
  );
}
