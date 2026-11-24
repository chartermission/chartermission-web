import Link from "next/link";
import type { GroupRole, GroupSummary, GroupVisibility } from "@chartermission/contracts";
import { Icon, cn } from "@chartermission/ui";
import { PageLogo } from "@/components/pages/page-logo";
import { pageHref } from "@/components/social/links";

/*
 * Small pieces shared by the group screens (cards, header, posts). No hooks here, so server
 * components can use them too.
 */

export const groupHref = (slug: string) => `/groups/${slug}`;

/** A padlock, for private groups (the icon set has none). */
export function LockIcon({ size = 14, className, label }: { size?: number; className?: string; label?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("shrink-0", className)}
    >
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

/** A group's logo: a rounded square like a page's, with the group's initial when there is no picture. */
export function GroupLogo({ name, src, size = 48, className }: { name: string; src?: string | null; size?: number; className?: string }) {
  return <PageLogo name={name} src={src} size={size} className={className} />;
}

/** "Public" with a globe, or "Private" with a padlock. */
export function VisibilityChip({ visibility, className }: { visibility: GroupVisibility; className?: string }) {
  const priv = visibility === "private";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        priv ? "bg-muted text-body" : "bg-primary-tint text-primary",
        className,
      )}
    >
      {priv ? <LockIcon size={12} /> : <Icon name="globe" size={12} />}
      {priv ? "Private" : "Public"}
    </span>
  );
}

export const ROLE_LABEL: Record<GroupRole, string> = { owner: "Owner", admin: "Admin", moderator: "Moderator", member: "Member" };

/** The page or chapter that runs a group, as a link (nothing for member-run groups). */
export function RunBy({ group, className }: { group: Pick<GroupSummary, "ownerType" | "page" | "chapter">; className?: string }) {
  const owner =
    group.ownerType === "page" && group.page
      ? { href: pageHref(group.page.slug), name: group.page.name, icon: "building" as const }
      : group.ownerType === "chapter" && group.chapter
        ? { href: `/chapters/${group.chapter.slug}`, name: group.chapter.name, icon: "globe" as const }
        : null;
  if (!owner) return null;
  return (
    <span className={cn("flex min-w-0 items-center gap-1", className)}>
      <Icon name={owner.icon} size={14} className="shrink-0" />
      <span className="shrink-0">Run by</span>
      <Link href={owner.href} className="relative z-10 truncate font-medium text-primary-light hover:underline">
        {owner.name}
      </Link>
    </span>
  );
}
