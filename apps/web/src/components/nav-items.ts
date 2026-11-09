import type { IconName } from "@chartermission/ui";

/** Member section navigation, shared by SideNav and SectionNav. */
export const sectionNavItems: { href: string; label: string; icon: IconName }[] = [
  { href: "/feed", label: "Home", icon: "home" },
  { href: "/articles", label: "Articles", icon: "dashboard" },
  { href: "/network", label: "Network", icon: "users" },
  { href: "/opportunities", label: "Opportunities", icon: "briefcase" },
  { href: "/initiatives", label: "Initiatives", icon: "lightbulb" },
  { href: "/events", label: "Events", icon: "calendar" },
  { href: "/learning", label: "Learning", icon: "book" },
  { href: "/chapters", label: "Chapters", icon: "globe" },
  { href: "/ambassadors", label: "Ambassadors", icon: "shield" },
  { href: "/organisations", label: "Organisations", icon: "building" },
  { href: "/bookmarks", label: "Saved", icon: "bookmark" },
  { href: "/drafts", label: "Drafts", icon: "send" },
];
