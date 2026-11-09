import { LEAD_CLOSED_STAGES, LEAD_OPEN_STAGES, LEAD_STAGE_LABELS, LeadStage } from "@chartermission/contracts";
import type { ChipTone } from "@chartermission/ui";

/** Board filters, read from and written to the URL. */
export type LeadsView = {
  stage: LeadStage | "open" | "closed" | "all";
  country: string;
  q: string;
  owner: "" | "me";
};

const STAGE_VALUES = new Set<string>([...LeadStage.options, "open", "closed", "all"]);

export function parseLeadsView(params: Record<string, string | string[] | undefined>): LeadsView {
  const one = (k: string) => {
    const v = params[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
  };
  const stage = one("stage");
  const country = one("country").toUpperCase();
  return {
    stage: STAGE_VALUES.has(stage) ? (stage as LeadsView["stage"]) : "open",
    country: /^[A-Z]{2}$/.test(country) ? country : "",
    q: one("q").slice(0, 100),
    owner: one("owner") === "me" ? "me" : "",
  };
}

export function leadsSearch(view: LeadsView): string {
  const qs = new URLSearchParams();
  if (view.stage !== "open") qs.set("stage", view.stage);
  if (view.country) qs.set("country", view.country);
  if (view.q) qs.set("q", view.q);
  if (view.owner) qs.set("owner", view.owner);
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export function leadsApiQuery(view: LeadsView) {
  return { stage: view.stage, country: view.country || undefined, q: view.q || undefined, owner: view.owner || undefined };
}

export const STAGE_TONE: Record<LeadStage, ChipTone> = {
  new: "info",
  screening: "neutral",
  review: "neutral",
  interview: "neutral",
  references: "neutral",
  decision: "neutral",
  onboarding: "warning",
  ambassador: "success",
  alumni: "neutral",
  talent_pool: "info",
  declined: "error",
  withdrawn: "neutral",
};

/** Tabs above the board: the open group, each open stage, then where leads end up. */
export const STAGE_TABS: { value: LeadsView["stage"]; label: string }[] = [
  { value: "open", label: "All open" },
  ...LEAD_OPEN_STAGES.map((s) => ({ value: s, label: LEAD_STAGE_LABELS[s] })),
  ...LEAD_CLOSED_STAGES.map((s) => ({ value: s, label: LEAD_STAGE_LABELS[s] })),
  { value: "all", label: "Everything" },
];

/** Stages a manager can move a lead to by hand ("ambassador" comes from certifying, "alumni" from ending a term). */
export const MOVABLE_STAGES = LeadStage.options.filter((s) => s !== "ambassador" && s !== "alumni");
