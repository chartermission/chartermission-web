import type { MemberRef } from "@chartermission/contracts";
import { Avatar, cn } from "@chartermission/ui";
import { countryNameOf } from "@/i18n/places";

/** "NG" → "Nigeria" in the page language (falls back to the code). */
export function countryName(code: string | null | undefined, intl = "en-GB"): string | null {
  return countryNameOf(code, intl);
}

const wordsCache = new Map<string, Intl.RelativeTimeFormat>();

/** "today", "yesterday", "3 days ago", "2 weeks ago", in the page language. */
export function daysAgo(iso: string, intl = "en-GB", now = Date.now()): string {
  let words = wordsCache.get(intl);
  if (!words) {
    words = new Intl.RelativeTimeFormat(intl, { numeric: "auto" });
    wordsCache.set(intl, words);
  }
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
