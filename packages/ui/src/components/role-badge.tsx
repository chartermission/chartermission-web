import { cn } from "../cn";

/** Same shape as MemberBadge in @chartermission/contracts (kept local so the design system has no dependency on it). */
export type RoleBadgeData = {
  kind: "ambassador" | "founding_ambassador" | "alumni_ambassador";
  label: string;
  place: string;
};

const SHIELD = "M12 2L20 5V11C20 16.2 16.6 20.4 12 22C7.4 20.4 4 16.2 4 11V5Z";
const MARK = "M14.8 9.4A3.8 3.8 0 1 0 14.8 14.6";

const STYLE: Record<RoleBadgeData["kind"], { fill: string; edge: string | null; mark: string; dot: string | null }> = {
  ambassador: { fill: "var(--color-primary)", edge: null, mark: "var(--color-inverse)", dot: "var(--color-warning)" },
  founding_ambassador: { fill: "var(--color-primary)", edge: "var(--color-warning)", mark: "var(--color-inverse)", dot: "var(--color-warning)" },
  alumni_ambassador: { fill: "var(--color-muted)", edge: "var(--color-disabled)", mark: "var(--color-secondary)", dot: null },
};

/**
 * Ambassador shield beside a member's name (Figma "Badge icon", Foundations & Components):
 * filled for serving Ambassadors, a gold edge for the founding cohort, grey for alumni.
 * The label and place are the accessible name and the tooltip.
 */
export function RoleBadgeIcon({ badge, size = 16, className }: { badge: RoleBadgeData | null | undefined; size?: number; className?: string }) {
  if (!badge) return null;
  const s = STYLE[badge.kind];
  const title = `${badge.label} · ${badge.place}`;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} role="img" aria-label={title} className={cn("shrink-0", className)}>
      <title>{title}</title>
      <path d={SHIELD} fill={s.fill} stroke={s.edge ?? "none"} strokeWidth={s.edge ? 1.6 : 0} />
      <path d={MARK} fill="none" stroke={s.mark} strokeWidth={2.2} strokeLinecap="round" />
      {s.dot && <circle cx="16.4" cy="12" r="1.35" fill={s.dot} />}
    </svg>
  );
}

const PILL: Record<RoleBadgeData["kind"], string> = {
  ambassador: "bg-primary-tint text-primary",
  founding_ambassador: "bg-warning-light text-primary-dark ring-1 ring-warning",
  alumni_ambassador: "bg-muted text-secondary",
};

/** Profile-header pill: "Ambassador · Nigeria Chapter" (Figma "Badge pill"). */
export function RoleBadgePill({ badge, className }: { badge: RoleBadgeData | null | undefined; className?: string }) {
  if (!badge) return null;
  return (
    <span className={cn("inline-flex w-fit items-center gap-1.5 rounded-full py-1 pr-3 pl-1.5 text-sm font-semibold", PILL[badge.kind], className)}>
      <RoleBadgeIcon badge={badge} size={20} className="pointer-events-none" />
      <span>
        {badge.label} · {badge.place}
      </span>
    </span>
  );
}
