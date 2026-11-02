import type { IconName } from "@chartermission/ui";

/** Signed-in staff member shown in the admin bar. */
export const staffViewer = {
  name: "Owais Iqbal",
  shortName: "Owais I.",
  mfaMinutesLeft: 28,
};

export type ConsoleNavItem = {
  href: string;
  label: string;
  icon: IconName;
  /** Open work items, shown as a count badge. */
  count?: number;
};

/** Admin sidebar sections (Figma "Sidebar", node 12:1570). */
export const consoleNav: ConsoleNavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/moderation", label: "Moderation", icon: "shield", count: 23 },
  { href: "/listings", label: "Listing review", icon: "check", count: 15 },
  { href: "/trending", label: "Trending controls", icon: "trending" },
  { href: "/members", label: "Members", icon: "users" },
  { href: "/verification", label: "Verification", icon: "verified", count: 4 },
  { href: "/chapters", label: "Chapters", icon: "globe" },
  { href: "/cms", label: "CMS & pages", icon: "book" },
  { href: "/audit-log", label: "Audit log", icon: "clock" },
  { href: "/analytics", label: "Analytics", icon: "chart" },
];
