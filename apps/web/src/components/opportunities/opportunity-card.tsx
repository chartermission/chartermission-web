"use client";

import Link from "next/link";
import { useState } from "react";
import {
  APPLICATION_STATUS_LABELS,
  OPPORTUNITY_TYPE_LABELS,
  opportunityPlace,
  type ApplicationStatus,
  type OpportunitySummary,
} from "@chartermission/contracts";
import { Chip, Icon, cn, type ChipTone } from "@chartermission/ui";
import { addDays, formatDayMonth } from "@/components/discover/dates";
import { toast } from "@/components/social/toast";
import { api } from "@/lib/api/client";

export const applicationTone: Record<ApplicationStatus, ChipTone> = {
  submitted: "info",
  shortlisted: "warning",
  accepted: "success",
  declined: "neutral",
  withdrawn: "neutral",
};

/** Today in UTC, matching the API's whole-day deadlines. */
export const todayIso = () => new Date().toISOString().slice(0, 10);

/** "Closes 14 Nov" (warning within a week), "Closed", or "Rolling". */
export function deadlineChip(o: Pick<OpportunitySummary, "deadline" | "status">): { label: string; tone: ChipTone } {
  if (o.status === "closed") return { label: "Closed", tone: "neutral" };
  if (!o.deadline) return { label: "Rolling deadline", tone: "neutral" };
  const today = todayIso();
  if (o.deadline === today) return { label: "Closes today", tone: "warning" };
  return { label: `Closes ${formatDayMonth(o.deadline)}`, tone: o.deadline <= addDays(today, 7) ? "warning" : "neutral" };
}

/** Save / Saved toggle (PUT / DELETE /bookmarks). */
export function SaveOpportunityButton({ id, title, saved: initial, onChange }: { id: string; title: string; saved: boolean; onChange?: (saved: boolean) => void }) {
  const [saved, setSaved] = useState(initial);
  async function toggle() {
    const next = !saved;
    setSaved(next);
    try {
      await api("/bookmarks", { method: next ? "PUT" : "DELETE", body: { targetType: "opportunity", targetId: id } });
      toast.success(next ? "Saved" : "Removed from saved");
      onChange?.(next);
    } catch (e) {
      setSaved(!next);
      toast.error(e);
    }
  }
  return (
    <button
      type="button"
      aria-pressed={saved}
      onClick={toggle}
      className={cn("rounded-md p-1 hover:bg-muted", saved ? "text-primary" : "text-secondary")}
    >
      <Icon name="bookmark" size={20} fill={saved ? "currentColor" : "none"} />
      <span className="sr-only">{saved ? `Saved: ${title}` : `Save ${title}`}</span>
    </button>
  );
}

/** One listing in a list: type, title, organisation and place, chips, save. */
export function OpportunityListCard({ item, showStatus = false, onSavedChange }: { item: OpportunitySummary; showStatus?: boolean; onSavedChange?: (saved: boolean) => void }) {
  const deadline = deadlineChip(item);
  const chips: { label: string; tone: ChipTone }[] = [{ label: OPPORTUNITY_TYPE_LABELS[item.type], tone: "info" }];
  if (item.sector) chips.push({ label: item.sector.name, tone: "neutral" });
  chips.push(deadline);
  if (item.viewer.applicationStatus) chips.push({ label: APPLICATION_STATUS_LABELS[item.viewer.applicationStatus], tone: applicationTone[item.viewer.applicationStatus] });
  if (showStatus && item.viewer.isOwner) chips.push({ label: `${item.applicationCount} ${item.applicationCount === 1 ? "applicant" : "applicants"}`, tone: "active" });
  if (item.moderationState !== "visible") chips.push({ label: item.moderationState === "removed" ? "Removed by moderators" : "Hidden by moderators", tone: "error" });

  return (
    <article className="flex w-full items-start gap-4 rounded-card border border-line bg-card p-5">
      <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-[10px] bg-primary-tint text-primary">
        <Icon name="briefcase" size={22} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <h3 className="text-h3 text-ink">
          <Link href={`/opportunities/${item.slug}`} className="hover:underline">
            {item.title}
          </Link>
        </h3>
        <p className="text-sm text-secondary">
          {item.organisation} · {opportunityPlace(item)}
          {item.compensation ? ` · ${item.compensation}` : ""}
        </p>
        <p className="line-clamp-2 text-sm text-body">{item.summary}</p>
        <ul className="flex flex-wrap gap-2 pt-1" aria-label="Details">
          {chips.map((chip) => (
            <li key={chip.label}>
              <Chip tone={chip.tone}>{chip.label}</Chip>
            </li>
          ))}
        </ul>
      </div>
      {!item.viewer.isOwner && <SaveOpportunityButton id={item.id} title={item.title} saved={item.viewer.saved} onChange={onSavedChange} />}
    </article>
  );
}
