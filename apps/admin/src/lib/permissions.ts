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
];

/** The highest privileged role, as shown in the admin bar. */
export function roleLabel(roles: readonly string[]): string {
  return ROLE_LABELS.find(([role]) => roles.includes(role))?.[1] ?? "Staff";
}

export type NavKey = "moderation" | "hidden" | "appeals" | "trending" | "audit";

export type ConsoleNavItem = {
  key: NavKey;
  href: string;
  label: string;
  icon: IconName;
  permission: string;
  /** Open work items, shown as a count badge. */
  count?: number;
};

/** Admin sidebar sections for Phase 1 (Figma "Sidebar", node 12:1570). */
export const CONSOLE_NAV: ConsoleNavItem[] = [
  { key: "moderation", href: "/moderation", label: "Moderation", icon: "shield", permission: PERM.moderationView },
  { key: "hidden", href: "/moderation/hidden", label: "Hidden content", icon: "eye-off", permission: PERM.moderationView },
  { key: "appeals", href: "/appeals", label: "Appeals", icon: "flag", permission: PERM.moderationView },
  { key: "trending", href: "/trending", label: "Trending", icon: "trending", permission: PERM.moderationView },
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
