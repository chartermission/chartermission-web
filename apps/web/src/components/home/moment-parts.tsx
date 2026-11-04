import type { MemberRef } from "@chartermission/contracts";
import { Avatar, cn } from "@chartermission/ui";

const regionNames = typeof Intl !== "undefined" && "DisplayNames" in Intl ? new Intl.DisplayNames(["en"], { type: "region" }) : null;

/** "NG" → "Nigeria" (falls back to the code). */
export function countryName(code: string | null | undefined): string | null {
  if (!code) return null;
  try {
    return regionNames?.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

const words = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "today", "yesterday", "3 days ago", "2 weeks ago". */
export function daysAgo(iso: string, now = Date.now()): string {
  const days = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 86_400_000));
  if (days < 14) return words.format(-days, "day");
  return words.format(-Math.floor(days / 7), "week");
}

/** Overlapping avatars (decorative: pair with text that says who or how many). */
export function AvatarStack({ members, size = 32, max = 4, className }: { members: Pick<MemberRef, "id" | "name" | "avatarUrl" | "tone">[]; size?: 24 | 32; max?: number; className?: string }) {
  return (
    <span aria-hidden="true" className={cn("flex", size === 24 ? "-space-x-1.5" : "-space-x-2.5", className)}>
      {members.slice(0, max).map((member) => (
        <Avatar key={member.id} name={member.name} src={member.avatarUrl ?? undefined} tone={member.tone} size={size} className="ring-2 ring-card" />
      ))}
    </span>
  );
}
