import { cn } from "../cn";
import { Icon, iconNames, type IconName } from "../icons";

/** Same shape as ProfileBadge in @chartermission/contracts (kept local so the design system has no dependency on it). */
export type ProfileBadgeData = {
  slug: string;
  name: string;
  description: string;
  tone: "primary" | "accent" | "warning" | "info" | "success";
  icon: string;
};

const TONE: Record<ProfileBadgeData["tone"], string> = {
  primary: "bg-primary-tint text-primary ring-primary/20",
  accent: "bg-accent-light text-accent-hover ring-accent/20",
  warning: "bg-warning-light text-primary-dark ring-warning/50",
  info: "bg-info-light text-info ring-info/25",
  success: "bg-success-light text-primary-light ring-success/30",
};

const iconOf = (name: string): IconName => ((iconNames as string[]).includes(name) ? (name as IconName) : "verified");

/** One admin-awarded badge as a pill (icon + name); the description is the tooltip. */
export function ProfileBadgeChip({ badge, size = "default", className }: { badge: ProfileBadgeData; size?: "default" | "small"; className?: string }) {
  return (
    <span
      title={badge.description || badge.name}
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-medium whitespace-nowrap ring-1 ring-inset",
        size === "small" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm",
        TONE[badge.tone] ?? TONE.primary,
        className,
      )}
    >
      <Icon name={iconOf(badge.icon)} size={size === "small" ? 12 : 14} />
      {badge.name}
    </span>
  );
}

/** A member's badges, wrapped. Renders nothing when there are none. */
export function ProfileBadgeList({ badges, size, className }: { badges: ProfileBadgeData[]; size?: "default" | "small"; className?: string }) {
  if (!badges.length) return null;
  return (
    <ul aria-label="Badges" className={cn("flex flex-wrap gap-1.5", className)}>
      {badges.map((b) => (
        <li key={b.slug}>
          <ProfileBadgeChip badge={b} size={size} />
        </li>
      ))}
    </ul>
  );
}
