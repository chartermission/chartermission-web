"use client";

import type { AdminMemberRow } from "@chartermission/contracts";
import { Chip, cn } from "@chartermission/ui";
import { useT } from "@/i18n/client";
import { ROLE_INFO } from "./member-dialogs";

/** What sets a member apart: roles, team, official account, sign-up suggestion, Claude access. */
export function memberTags(row: AdminMemberRow, t: (key: string, vars?: Record<string, string | number>) => string) {
  const tags: { key: string; label: string; tone: "success" | "neutral" | "info" | "warning" }[] = [];
  for (const r of ROLE_INFO) if (row.roles.includes(r.role)) tags.push({ key: r.role, label: t(r.name), tone: r.console ? "success" : "neutral" });
  if (row.official) tags.push({ key: "official", label: t("Official account · follow only"), tone: "warning" });
  if (row.staff && !row.official) tags.push({ key: "team", label: t("Team member"), tone: "neutral" });
  if (row.featured) tags.push({ key: "featured", label: t("Suggested on sign-up"), tone: "info" });
  if (row.mcpAccess) tags.push({ key: "claude", label: row.mcpConnections > 0 ? t("Claude · {count} connected", { count: row.mcpConnections }) : "Claude", tone: "info" });
  return tags;
}

/** The member's tags as chips. `compact` fits them in a table row: smaller, at most `max`, then "+N". */
export function MemberChips({ row, compact, max = 99 }: { row: AdminMemberRow; compact?: boolean; max?: number }) {
  const t = useT();
  const tags = memberTags(row, t);
  if (!tags.length) return null;
  const shown = tags.slice(0, max);
  const rest = tags.slice(max);
  return (
    <span className={cn("flex items-center gap-1", compact ? "flex-nowrap" : "flex-wrap")}>
      {shown.map((tag) => (
        <Chip key={tag.key} tone={tag.tone} className={cn(compact && "px-2 py-0 text-xs")}>
          {tag.label}
        </Chip>
      ))}
      {rest.length > 0 && (
        <span className="text-xs text-secondary" title={rest.map((r) => r.label).join(", ")}>
          +{rest.length}
        </span>
      )}
    </span>
  );
}
