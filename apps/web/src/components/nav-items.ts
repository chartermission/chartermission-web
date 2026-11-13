import type { IconName } from "@chartermission/ui";

/** Keys under `nav.` in the message files. */
export type NavKey = "home" | "articles" | "network" | "opportunities" | "initiatives" | "events" | "learning" | "exams" | "chapters" | "ambassadors" | "pages" | "saved" | "drafts" | "analytics" | "alerts" | "messages";

/** Member section navigation, shared by SideNav and SectionNav. `label` is the English name; show t(`nav.${key}`). */
export const sectionNavItems: { href: string; key: NavKey; label: string; icon: IconName }[] = [
  { href: "/feed", key: "home", label: "Home", icon: "home" },
  { href: "/articles", key: "articles", label: "Articles", icon: "dashboard" },
  { href: "/network", key: "network", label: "Network", icon: "users" },
  { href: "/opportunities", key: "opportunities", label: "Opportunities", icon: "briefcase" },
  { href: "/initiatives", key: "initiatives", label: "Initiatives", icon: "lightbulb" },
  { href: "/events", key: "events", label: "Events", icon: "calendar" },
  { href: "/learning", key: "learning", label: "Learning", icon: "book" },
  { href: "/chapters", key: "chapters", label: "Chapters", icon: "globe" },
  { href: "/ambassadors", key: "ambassadors", label: "Ambassadors", icon: "shield" },
  { href: "/pages", key: "pages", label: "Pages", icon: "building" },
  { href: "/bookmarks", key: "saved", label: "Saved", icon: "bookmark" },
  { href: "/drafts", key: "drafts", label: "Drafts", icon: "send" },
  { href: "/analytics", key: "analytics", label: "Analytics", icon: "chart" },
];
