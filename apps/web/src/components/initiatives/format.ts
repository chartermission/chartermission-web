import { INITIATIVE_STATUS_LABELS, type InitiativeHost, type InitiativeStatus, type InitiativeSummary } from "@chartermission/contracts";
import type { ChipTone } from "@chartermission/ui";
import type { Translate } from "@/i18n/translate";

/** Status chip label and tone. */
export const initiativeStatusMeta: Record<InitiativeStatus, { label: string; tone: ChipTone }> = {
  idea: { label: INITIATIVE_STATUS_LABELS.idea, tone: "neutral" },
  recruiting: { label: INITIATIVE_STATUS_LABELS.recruiting, tone: "success" },
  active: { label: INITIATIVE_STATUS_LABELS.active, tone: "info" },
  paused: { label: INITIATIVE_STATUS_LABELS.paused, tone: "warning" },
  completed: { label: INITIATIVE_STATUS_LABELS.completed, tone: "neutral" },
  archived: { label: INITIATIVE_STATUS_LABELS.archived, tone: "neutral" },
};

export const initiativeHref = (slug: string) => `/initiatives/${encodeURIComponent(slug)}`;

/** "Milestone 3 of 6 · Second corridor", "All 4 milestones done", "No milestones yet". */
export function progressLabel(t: Translate, i: Pick<InitiativeSummary, "milestones">): string {
  const { done, total, current } = i.milestones;
  if (!total) return t("No milestones yet");
  if (done === total) return t("All {count} milestones done", { count: total });
  return current
    ? t("Milestone {number} of {total} · {title}", { number: done + 1, total, title: current })
    : t("Milestone {number} of {total}", { number: done + 1, total });
}

/** Who runs it, for "Hosted by …" lines. */
export function hostName(host: InitiativeHost): string {
  if (host.type === "page") return host.page.name;
  if (host.type === "chapter") return host.chapter.name;
  return host.member.name;
}

export function hostHref(host: InitiativeHost): string {
  if (host.type === "page") return `/pages/${host.page.slug}`;
  if (host.type === "chapter") return `/chapters/${host.chapter.slug}`;
  return `/${host.member.handle}`;
}
