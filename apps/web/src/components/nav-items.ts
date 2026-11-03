import type { IconName } from "@chartermission/ui";

/** Member section navigation, shared by SideNav and SectionNav. */
export const sectionNavItems: { href: string; label: string; icon: IconName }[] = [
  { href: "/feed", label: "Home", icon: "home" },
  { href: "/network", label: "Network", icon: "users" },
  { href: "/opportunities", label: "Opportunities", icon: "briefcase" },
  { href: "/initiatives", label: "Initiatives", icon: "lightbulb" },
  { href: "/events", label: "Events", icon: "calendar" },
  { href: "/learning", label: "Learning", icon: "book" },
  { href: "/chapters", label: "Chapters", icon: "globe" },
  { href: "/organisations", label: "Organisations", icon: "building" },
  { href: "/bookmarks", label: "Saved", icon: "bookmark" },
];
