"use client";

import Link from "next/link";
import { OPPORTUNITY_TYPE_LABELS, REMOTE_MODE_LABELS, type OpportunityCard, type OpportunitySummary } from "@chartermission/contracts";
import { Chip, Icon, buttonClasses, cn } from "@chartermission/ui";
import { useIntlTag, useT } from "@/i18n/client";
import { OPPORTUNITY_TYPE_ICONS, applyLinkLabel } from "./apply-link";
import { applyByLabel, todayIso } from "./opportunity-dates";

/** A listing as a shared card (the Share to feed preview uses the listing the viewer has open). */
export function toOpportunityCard(o: OpportunitySummary): OpportunityCard {
  return {
    id: o.id,
    slug: o.slug,
    type: o.type,
    title: o.title,
    organisation: o.organisation,
    summary: o.summary,
    remoteMode: o.remoteMode,
    country: o.country,
    city: o.city,
    deadline: o.deadline,
    status: o.status === "open" && !(o.deadline && o.deadline < todayIso()) ? "open" : "closed",
    applyUrl: o.applyUrl,
    page: o.page,
    poster: o.poster,
  };
}

/**
 * An opportunity shared to the feed, inside its post: type, title, organisation, where, until when,
 * and the next step — Apply (the listing, where members apply in Charter Mission) or "Apply on
 * {host}" / "Apply by email" straight to the organisation for listings that take applications
 * elsewhere — plus View. Null: the listing was taken down. `preview`: the copy in the Share to feed
 * dialog, without links or buttons.
 */
export function OpportunityShareCard({ opportunity: o, preview = false }: { opportunity: OpportunityCard | null; preview?: boolean }) {
  const t = useT();
  const intl = useIntlTag();
  if (!o) {
    return (
      <p className="flex w-full items-center gap-2 rounded-[10px] border border-dashed border-line-strong bg-surface px-4 py-3 text-sm text-secondary">
        <Icon name="eye-off" size={16} />
        This opportunity is no longer available.
      </p>
    );
  }
  const href = `/opportunities/${o.slug}`;
  const closed = o.status === "closed";
  const when = applyByLabel(intl, t, o);
  return (
    <article className={cn("relative flex w-full flex-col gap-3 overflow-hidden rounded-[10px] border border-line p-4 max-sm:p-3.5", !preview && "hover:bg-surface")}>
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-[10px] bg-primary-tint text-primary">
          <Icon name={OPPORTUNITY_TYPE_ICONS[o.type]} size={20} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip tone="info">{OPPORTUNITY_TYPE_LABELS[o.type]}</Chip>
            {closed && <Chip>Closed</Chip>}
          </div>
          <h3 dir="auto" className={cn("bidi-auto text-md font-semibold", closed ? "text-secondary" : "text-ink")}>
            {preview ? (
              o.title
            ) : (
              <Link href={href} className="after:absolute after:inset-0 hover:underline focus-visible:outline-none">
                {o.title}
              </Link>
            )}
          </h3>
          <p dir="auto" className="bidi-auto truncate text-sm text-secondary">
            {o.organisation}
          </p>
        </div>
      </div>
      <p dir="auto" className="bidi-auto line-clamp-2 text-sm text-body">
        {o.summary}
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-body">
        <span className="flex min-w-0 items-center gap-1.5">
          <Icon name={o.remoteMode === "remote" ? "globe" : "map-pin"} size={16} className="shrink-0 text-secondary" />
          {/* City, country and work mode as separate pieces, so the country and mode read in the page's language. */}
          <span className="truncate">
            {o.city && <span>{o.city}</span>}
            {o.city && o.country && ", "}
            {o.country && <span>{o.country.name}</span>}
            {(o.city || o.country) && " · "}
            <span>{REMOTE_MODE_LABELS[o.remoteMode]}</span>
          </span>
        </span>
        <span className={cn("flex items-center gap-1.5", when.tone === "warning" && !closed && "font-medium text-warning")}>
          <Icon name="calendar" size={16} className="shrink-0 text-secondary" />
          {when.label}
        </span>
      </div>
      {!preview && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Link href={href} className={cn(buttonClasses({ size: "small", variant: "secondary" }), "relative z-10")}>
            View
            <span className="sr-only"> {o.title}</span>
          </Link>
          {!closed &&
            (o.applyUrl ? (
              <a
                href={o.applyUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className={cn(buttonClasses({ size: "small" }), "relative z-10 max-w-full")}
              >
                <Icon name={o.applyUrl.startsWith("mailto:") ? "mail" : "external"} size={16} className="shrink-0" />
                <span className="truncate">{applyLinkLabel(t, o.applyUrl)}</span>
                <span className="sr-only"> {o.title}</span>
              </a>
            ) : (
              <Link href={`${href}#apply`} className={cn(buttonClasses({ size: "small" }), "relative z-10")}>
                Apply
                <span className="sr-only"> {o.title}</span>
              </Link>
            ))}
        </div>
      )}
    </article>
  );
}
