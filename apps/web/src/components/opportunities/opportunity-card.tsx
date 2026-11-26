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
import { toast } from "@/components/social/toast";
import { api } from "@/lib/api/client";
import { useT, useIntlTag } from "@/i18n/client";
import { PageName } from "@/components/pages/page-card";
import { PageLogo } from "@/components/pages/page-logo";
import { pageHref } from "@/components/social/links";
import { OPPORTUNITY_TYPE_ICONS } from "./apply-link";
import { deadlineChip } from "./opportunity-dates";

export const applicationTone: Record<ApplicationStatus, ChipTone> = {
  submitted: "info",
  shortlisted: "warning",
  accepted: "success",
  declined: "neutral",
  withdrawn: "neutral",
};


/** Save / Saved toggle (PUT / DELETE /bookmarks). */
export function SaveOpportunityButton({ id, title, saved: initial, onChange }: { id: string; title: string; saved: boolean; onChange?: (saved: boolean) => void }) {
  const t = useT();
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
      <span className="sr-only">{saved ? t("Saved: {title}", { title }) : t("Save {title}", { title })}</span>
    </button>
  );
}

/** One listing in a list: type, title, organisation and place, chips, save. */
export function OpportunityListCard({ item, showStatus = false, onSavedChange }: { item: OpportunitySummary; showStatus?: boolean; onSavedChange?: (saved: boolean) => void }) {
  const intl = useIntlTag();
  const t = useT();
  const deadline = deadlineChip(intl, t, item);
  const chips: { label: string; tone: ChipTone }[] = [{ label: OPPORTUNITY_TYPE_LABELS[item.type], tone: "info" }];
  if (item.sector) chips.push({ label: item.sector.name, tone: "neutral" });
  chips.push(deadline);
  if (item.viewer.applicationStatus) chips.push({ label: APPLICATION_STATUS_LABELS[item.viewer.applicationStatus], tone: applicationTone[item.viewer.applicationStatus] });
  // Listings that take applications on the organisation's side have no applicants to count here.
  if (item.applyUrl) chips.push({ label: t("Apply on their site"), tone: "neutral" });
  else if (showStatus && item.viewer.isOwner) chips.push({ label: `${item.applicationCount} ${item.applicationCount === 1 ? "applicant" : "applicants"}`, tone: "active" });
  if (item.moderationState !== "visible") chips.push({ label: item.moderationState === "removed" ? "Removed by moderators" : "Hidden by moderators", tone: "error" });

  return (
    <article className="flex w-full items-start gap-4 rounded-card border border-line bg-card p-5">
      {item.page ? (
        <PageLogo name={item.page.name} src={item.page.logoUrl} size={48} />
      ) : (
        <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-[10px] bg-primary-tint text-primary">
          <Icon name={OPPORTUNITY_TYPE_ICONS[item.type]} size={22} />
        </span>
      )}
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
        {item.page && (
          <p className="flex min-w-0 items-center gap-1 text-xs text-secondary">
            <span className="shrink-0">Posted by</span>
            <Link href={pageHref(item.page.slug)} className="min-w-0 font-medium text-ink hover:underline">
              <PageName page={item.page} className="flex min-w-0 items-center gap-1" />
            </Link>
          </p>
        )}
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
