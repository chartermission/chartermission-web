import type { SessionUser } from "@chartermission/contracts";
import type { IconName } from "@chartermission/ui";

/** Permission names the console checks (the API enforces the same names on every request). */
export const PERM = {
  moderationView: "moderation.view",
  moderationAct: "moderation.act",
  appealDecide: "appeal.decide",
  trendingManage: "trending.manage",
  auditView: "audit.view",
  auditExport: "audit.export",
  /** Platform Admin and above; gates the trending rules form (spec 4.17). */
  settingsManage: "settings.manage",
  /** Events review queue: approve / request changes / reject / unpublish. Moderator and above. */
  eventReview: "event.review",
  /** Feature an event. Platform Admin and above. */
  eventFeature: "event.feature",
  /** Host powers on any event (sees registrations). Platform Admin and above. */
  eventManage: "event.manage",
  /** Learning catalogue curation, link status and sync. Platform Admin and above. */
  courseCurate: "course.curate",
  /** Ambassador leads, pipeline, onboarding and certification (own countries). Ambassador Managers and Platform Admins. */
  ambassadorManage: "ambassador.manage",
  /** Ambassador Manager sub-accounts and required training. Platform Admin and above. */
  ambassadorManagers: "ambassador.managers",
  /** Chapter catalogue: add, remove, activate / deactivate, pictures and covers. Platform Admin and above. */
  chaptersAdmin: "chapters.admin",
  /** Verified tick, badges and featured sign-up suggestions. Platform Admin and above. */
  membersManage: "members.manage",
  /** Badge catalogue. Platform Admin and above. */
  badgesManage: "badges.manage",
} as const;

export type ConsoleViewer = Pick<SessionUser, "id" | "name" | "handle" | "avatarUrl" | "tone" | "roles" | "permissions">;

/** UI gate only: hiding a control is never access control (spec 4.17). */
export function can(viewer: Pick<SessionUser, "permissions">, permission: string): boolean {
  return viewer.permissions.includes(permission);
}

const ROLE_LABELS: [role: string, label: string][] = [
  ["super_admin", "Super Admin"],
  ["platform_admin", "Platform Admin"],
  ["moderator", "Moderator"],
  ["ambassador_manager", "Ambassador Manager"],
];

/**
 * Where an admin lands after sign-in: the first console section their permissions allow
 * (moderators and admins: the moderation queue; Ambassador Managers: Ambassadors).
 */
export function landingPath(viewer: Pick<SessionUser, "permissions">): string {
  return CONSOLE_NAV.find((item) => can(viewer, item.permission))?.href ?? "/moderation";
}

/** The highest privileged role, as shown in the admin bar. */
export function roleLabel(roles: readonly string[]): string {
  return ROLE_LABELS.find(([role]) => roles.includes(role))?.[1] ?? "Staff";
}

export type NavKey =
  | "moderation"
  | "hidden"
  | "appeals"
  | "trending"
  | "topics"
  | "events"
  | "courses"
  | "members"
  | "badges"
  | "chapters"
  | "ambassadors"
  | "ambassador-team"
  | "learning-access"
  | "media"
  | "audit";

export type ConsoleNavItem = {
  key: NavKey;
  href: string;
  label: string;
  icon: IconName;
  permission: string;
  /** Open work items, shown as a count badge. */
  count?: number;
};

/** Admin sidebar sections (Figma "Sidebar", node 12:1570; Events and Courses added in the events/learning round). */
export const CONSOLE_NAV: ConsoleNavItem[] = [
  { key: "moderation", href: "/moderation", label: "Moderation", icon: "shield", permission: PERM.moderationView },
  { key: "hidden", href: "/moderation/hidden", label: "Hidden content", icon: "eye-off", permission: PERM.moderationView },
  { key: "appeals", href: "/appeals", label: "Appeals", icon: "flag", permission: PERM.moderationView },
  { key: "trending", href: "/trending", label: "Trending", icon: "trending", permission: PERM.moderationView },
  { key: "topics", href: "/topics", label: "Topics", icon: "hash", permission: PERM.trendingManage },
  { key: "events", href: "/events", label: "Events", icon: "calendar", permission: PERM.eventReview },
  { key: "courses", href: "/courses", label: "Courses", icon: "book", permission: PERM.courseCurate },
  { key: "members", href: "/members", label: "Members", icon: "user", permission: PERM.membersManage },
  { key: "badges", href: "/badges", label: "Badges", icon: "verified", permission: PERM.badgesManage },
  { key: "chapters", href: "/chapters", label: "Chapters", icon: "map-pin", permission: PERM.chaptersAdmin },
  { key: "ambassadors", href: "/ambassadors", label: "Ambassadors", icon: "verified", permission: PERM.ambassadorManage },
  { key: "ambassador-team", href: "/ambassadors/team", label: "Ambassador team", icon: "users", permission: PERM.ambassadorManagers },
  { key: "learning-access", href: "/settings/learning", label: "E-learning access", icon: "target", permission: PERM.courseCurate },
  { key: "media", href: "/settings/media", label: "Media settings", icon: "video", permission: PERM.settingsManage },
  { key: "audit", href: "/audit", label: "Audit log", icon: "clock", permission: PERM.auditView },
];

/** Which nav item a path belongs to (the most specific match wins). */
export function activeNavKey(pathname: string): NavKey | null {
  let best: ConsoleNavItem | null = null;
  for (const item of CONSOLE_NAV) {
    if ((pathname === item.href || pathname.startsWith(`${item.href}/`)) && (!best || item.href.length > best.href.length)) {
      best = item;
    }
  }
  return best?.key ?? null;
}
