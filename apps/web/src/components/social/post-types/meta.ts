import {
  CELEBRATION_LABELS,
  REQUEST_LABELS,
  type CelebrationCategory,
  type PostType,
  type RequestCategory,
} from "@chartermission/contracts";
import type { IconName } from "@chartermission/ui";

/** Composer and card labels for each post type. */
export const postTypeMeta: Record<PostType, { label: string; icon: IconName; title: string; badge: string }> = {
  standard: { label: "Post", icon: "message", title: "Create post", badge: "Post" },
  question: { label: "Ask", icon: "lightbulb", title: "Ask the community", badge: "Question" },
  celebration: { label: "Celebrate", icon: "flame", title: "Share a milestone", badge: "Celebration" },
  request: { label: "Looking for", icon: "search", title: "Looking for…", badge: "Looking for" },
  article: { label: "Article", icon: "book", title: "Write an article", badge: "Article" },
};

export const postTypes = Object.keys(postTypeMeta) as PostType[];

export const celebrationMeta: Record<CelebrationCategory, { label: string; icon: IconName; placeholder: string }> = {
  new_role: { label: CELEBRATION_LABELS.new_role, icon: "briefcase", placeholder: "Started as Head of Partnerships at GreenGrid Africa" },
  launch: { label: CELEBRATION_LABELS.launch, icon: "send", placeholder: "Launched PayBridge in Ghana and Côte d’Ivoire" },
  funding: { label: CELEBRATION_LABELS.funding, icon: "trending", placeholder: "Closed our $2M seed round" },
  award: { label: CELEBRATION_LABELS.award, icon: "verified", placeholder: "Won the Africa Climate Innovation Award" },
  graduation: { label: CELEBRATION_LABELS.graduation, icon: "book", placeholder: "Graduated with an MSc in Development Finance" },
  milestone: { label: CELEBRATION_LABELS.milestone, icon: "target", placeholder: "Reached 10,000 farmers on the platform" },
};

export const celebrationCategories = Object.keys(celebrationMeta) as CelebrationCategory[];

export const requestMeta: Record<RequestCategory, { label: string; icon: IconName; placeholder: string }> = {
  cofounder: { label: REQUEST_LABELS.cofounder, icon: "user", placeholder: "A technical co-founder for a cold-chain startup" },
  mentor: { label: REQUEST_LABELS.mentor, icon: "lightbulb", placeholder: "A mentor who has raised a Series A in fintech" },
  volunteers: { label: REQUEST_LABELS.volunteers, icon: "users", placeholder: "Volunteers for our Lagos coding bootcamp" },
  partner: { label: REQUEST_LABELS.partner, icon: "building", placeholder: "Distribution partners in East Africa" },
  hire: { label: REQUEST_LABELS.hire, icon: "briefcase", placeholder: "A senior backend engineer, remote across Africa" },
  advice: { label: REQUEST_LABELS.advice, icon: "message", placeholder: "Advice on registering a company in Rwanda" },
};

export const requestCategories = Object.keys(requestMeta) as RequestCategory[];

/** "27 Nov 2026" for a YYYY-MM-DD date, without shifting it across time zones. */
export function formatDay(isoDay: string): string {
  const [y, m, d] = isoDay.split("-").map(Number);
  if (!y || !m || !d) return isoDay;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** Today as YYYY-MM-DD in the viewer's time zone. */
export function todayIso(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The day `days` from today, as YYYY-MM-DD in the viewer's time zone. */
export function isoDaysAhead(days: number): string {
  const at = new Date();
  at.setDate(at.getDate() + days);
  return todayIso(at);
}
