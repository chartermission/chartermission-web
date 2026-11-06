"use client";

import { useState, type ReactNode } from "react";
import {
  EVENT_FORMAT_LABELS,
  type AdminEventRow,
  type EventDetail,
  type EventHost,
  type MemberRef,
} from "@chartermission/contracts";
import { Avatar, Chip, Divider, Icon, buttonClasses, cn, type IconName } from "@chartermission/ui";
import { Age, DateTime } from "@/components/time";
import { eventStatusChip, isPublic, type EventRegistrationsPreview } from "@/lib/events-view";
import { formatCount } from "@/lib/format";
import { formatClock, formatInZone, sameDay } from "@/lib/zoned-time";
import { webHref } from "@/lib/navigation";

export type EventAction = "approve" | "request_changes" | "reject" | "unpublish" | "feature" | "unfeature";

export function hostName(host: EventHost): string {
  if (host.type === "member") return host.member.name;
  if (host.type === "chapter") return host.chapter.name;
  return host.organisation.name;
}

const HOST_KIND: Record<EventHost["type"], string> = { member: "Member host", chapter: "Chapter host", organisation: "Organisation host" };

function SectionLabel({ children }: { children: string }) {
  return <h3 className="text-label text-secondary uppercase">{children}</h3>;
}

function Fact({ icon, label, children }: { icon: IconName; label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2.5">
      <Icon name={icon} size={16} className="mt-0.5 shrink-0 text-secondary" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <dt className="text-xs text-secondary">{label}</dt>
        <dd className="text-sm break-words text-ink">{children}</dd>
      </div>
    </div>
  );
}

/** "Wed 9 Dec 2026, 16:00 – 18:00 GMT" in one zone; the end gets its own date when the event spans days. */
function rangeInZone(startsAt: string, endsAt: string, zone: string | undefined, zoneNames: boolean) {
  const start = formatInZone(startsAt, zone, { zoneName: false });
  const end = sameDay(startsAt, endsAt, zone) ? formatClock(endsAt, zone) : formatInZone(endsAt, zone, { zoneName: false });
  const zoneLabel = zoneNames
    ? (new Intl.DateTimeFormat("en-GB", { timeZone: zone, timeZoneName: "short" })
        .formatToParts(new Date(startsAt))
        .find((p) => p.type === "timeZoneName")?.value ?? "")
    : "";
  return `${start} – ${end}${zoneLabel ? ` ${zoneLabel}` : ""}`;
}

type HistoryItem = { at: string; icon: IconName; title: string; by?: MemberRef | null; note?: string | null; tone?: "error" | "success" };

/** Submission and review history from what the API keeps (latest submission and latest decision). */
function historyItems(detail: EventDetail, row: AdminEventRow | null): HistoryItem[] {
  const items: HistoryItem[] = [{ at: detail.createdAt, icon: "plus", title: "Created as a draft", by: row?.createdBy }];
  const submittedAt = row?.submittedAt ?? detail.review?.submittedAt;
  if (submittedAt) items.push({ at: submittedAt, icon: "send", title: "Submitted for review", note: row?.submitNote ? `Host’s note: ${row.submitNote}` : null });
  const reviewedAt = row?.reviewedAt ?? detail.review?.reviewedAt;
  const note = row?.reviewNote ?? detail.review?.note ?? null;
  if (reviewedAt) {
    const decision =
      detail.status === "changes_requested"
        ? { title: "Changes requested", icon: "message" as const }
        : detail.status === "rejected"
          ? { title: "Rejected", icon: "x" as const, tone: "error" as const }
          : detail.status === "unpublished"
            ? { title: "Unpublished", icon: "eye-off" as const, tone: "error" as const }
            : detail.status === "pending_review"
              ? { title: "Previous review", icon: "clock" as const }
              : { title: "Approved", icon: "check" as const, tone: "success" as const };
    items.push({ at: reviewedAt, ...decision, by: row?.reviewedBy, note });
  } else if (note && detail.status === "unpublished") {
    items.push({ at: detail.updatedAt, icon: "eye-off", title: "Unpublished", note, tone: "error" });
  }
  const publishedAt = detail.review?.publishedAt;
  if (publishedAt && !(reviewedAt && Math.abs(Date.parse(publishedAt) - Date.parse(reviewedAt)) < 5000)) {
    items.push({ at: publishedAt, icon: "globe", title: reviewedAt ? "Published" : "Published directly by staff", tone: "success" });
  }
  if (detail.cancelledAt) items.push({ at: detail.cancelledAt, icon: "alert", title: "Cancelled by the host", note: detail.cancelReason, tone: "error" });
  return items.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** Event descriptions are plain text with blank-line paragraphs and "## " headings. */
function Description({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return (
    <>
      {blocks.map((block, i) => {
        const [firstLine, ...rest] = block.split("\n");
        if (firstLine?.startsWith("## ")) {
          return (
            <div key={i} className="flex flex-col gap-1">
              <h4 className="text-sm font-semibold text-ink">{firstLine.slice(3)}</h4>
              {rest.length > 0 && <p className="whitespace-pre-wrap">{rest.join("\n")}</p>}
            </div>
          );
        }
        return (
          <p key={i} className="whitespace-pre-wrap">
            {block}
          </p>
        );
      })}
    </>
  );
}

const actionClasses = {
  primary: buttonClasses({ variant: "primary", size: "small" }),
  secondary: buttonClasses({ variant: "secondary", size: "small" }),
  danger: buttonClasses({ variant: "secondary", size: "small", className: "text-error!" }),
};

/** Everything a reviewer needs about one event, with the actions its status allows. */
export function EventReviewPanel({
  id,
  detail,
  row,
  registrations,
  canReview,
  canFeature,
  busy,
  hydrated,
  onAction,
}: {
  id: string;
  detail: EventDetail;
  row: AdminEventRow | null;
  registrations: EventRegistrationsPreview;
  canReview: boolean;
  canFeature: boolean;
  busy: boolean;
  hydrated: boolean;
  onAction: (action: EventAction) => void;
}) {
  const [showJoinLink, setShowJoinLink] = useState(false);
  const status = eventStatusChip(detail);
  const live = detail.status === "published" && !detail.cancelledAt;
  const pendingReview = detail.status === "pending_review";
  const history = historyItems(detail, row);
  const host = detail.host;

  const actions: { action: EventAction; label: string; style: keyof typeof actionClasses }[] = [];
  if (canReview && pendingReview) {
    actions.push({ action: "approve", label: "Approve", style: "primary" });
    actions.push({ action: "request_changes", label: "Request changes", style: "secondary" });
    actions.push({ action: "reject", label: "Reject", style: "danger" });
  }
  if (canReview && detail.status === "published") actions.push({ action: "unpublish", label: "Unpublish", style: "danger" });
  if (canFeature && live && !detail.past) {
    actions.unshift(
      detail.featured
        ? { action: "unfeature", label: "Unfeature", style: "secondary" }
        : { action: "feature", label: "Feature", style: "secondary" },
    );
  }

  return (
    <section
      id={id}
      aria-label={`Review: ${detail.title}`}
      aria-busy={busy}
      className={cn("flex min-w-0 flex-col gap-4 rounded-card border border-line bg-card p-4 transition-opacity sm:p-5", busy && "opacity-60")}
    >
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip tone={status.tone} className="px-2.5! py-0.5! text-xs!">
            {status.label}
          </Chip>
          {detail.featured && (
            <Chip tone="hashtag" className="gap-1 px-2.5! py-0.5! text-xs!">
              <Icon name="flame" size={12} />
              Featured
            </Chip>
          )}
          {detail.category && (
            <Chip tone="neutral" className="px-2.5! py-0.5! text-xs!">
              {detail.category.name}
            </Chip>
          )}
        </div>
        <h2 className="text-h3 break-words text-ink">{detail.title}</h2>
        <p className="text-sm text-body">{detail.summary}</p>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-secondary">
          <span>
            {detail.review?.submittedAt ? (
              <>
                Submitted <Age iso={detail.review.submittedAt} /> ago
              </>
            ) : (
              <>
                Created <DateTime iso={detail.createdAt} dateOnly />
              </>
            )}
          </span>
          {isPublic(detail) ? (
            <a
              href={webHref(`/events/${detail.slug}`)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-sm font-medium text-primary hover:underline"
            >
              View on site
              <Icon name="external" size={14} />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          ) : (
            <span>Not visible to members yet</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 rounded-lg bg-muted px-3 py-2.5">
        {host.type === "member" ? (
          <Avatar name={host.member.name} size={32} tone={host.member.tone} src={host.member.avatarUrl ?? undefined} />
        ) : (
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-card text-secondary">
            <Icon name={host.type === "chapter" ? "users" : "building"} size={16} />
          </span>
        )}
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-sm font-medium text-ink">{hostName(host)}</span>
          <span className="truncate text-xs text-secondary">
            {HOST_KIND[host.type]}
            {host.type === "member" && host.member.headline ? ` · ${host.member.headline}` : ""}
            {row && host.type !== "member" ? ` · created by ${row.createdBy.name}` : ""}
          </span>
        </div>
      </div>

      <dl className="flex flex-col gap-3">
        <Fact icon="clock" label={`When · event time (${detail.timezone})`}>
          {rangeInZone(detail.startsAt, detail.endsAt, detail.timezone, hydrated)}
          <span className="mt-0.5 block text-xs text-secondary">
            UTC: {rangeInZone(detail.startsAt, detail.endsAt, "UTC", false)} UTC
            {hydrated && (
              <>
                <br />
                Your time: {rangeInZone(detail.startsAt, detail.endsAt, undefined, true)}
              </>
            )}
          </span>
        </Fact>
        <Fact icon={detail.format === "online" ? "video" : detail.format === "hybrid" ? "globe" : "map-pin"} label="Format">
          {EVENT_FORMAT_LABELS[detail.format]}
        </Fact>
        {detail.venue && (
          <Fact icon="map-pin" label="Venue">
            {detail.venue.name}
            <span className="block text-xs text-secondary">
              {[detail.venue.address, detail.venue.city, detail.venue.countryCode].filter(Boolean).join(", ")}
            </span>
            {detail.venue.mapUrl && (
              <a href={detail.venue.mapUrl} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-primary hover:underline">
                Map link <span className="sr-only">(opens in a new tab)</span>
              </a>
            )}
          </Fact>
        )}
        {detail.online && (
          <Fact icon="video" label="Online access">
            {detail.online.platform}
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-secondary">
              {detail.online.joinUrl ? (
                <>
                  <span className="inline-flex items-center gap-1 text-success">
                    <Icon name="check" size={12} /> Join link set
                  </span>
                  <button
                    type="button"
                    aria-expanded={showJoinLink}
                    onClick={() => setShowJoinLink((v) => !v)}
                    className="rounded-sm font-medium text-primary hover:underline"
                  >
                    {showJoinLink ? "Hide link" : "Show link"}
                  </button>
                </>
              ) : detail.past ? (
                <span>Access link removed after the event</span>
              ) : (
                <span>Join link stored encrypted; shown to registered members from 24 h before start</span>
              )}
            </span>
            {showJoinLink && detail.online.joinUrl && (
              <code className="mt-1 block rounded-md bg-muted px-2 py-1 text-xs break-all text-ink">{detail.online.joinUrl}</code>
            )}
          </Fact>
        )}
        <Fact icon="users" label="Registration">
          {detail.registrationMode === "external" ? (
            <>
              External link
              {detail.externalUrl && (
                <a
                  href={detail.externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block truncate text-xs font-medium text-primary hover:underline"
                >
                  {detail.externalUrl}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              )}
            </>
          ) : (
            <>
              On Charter Mission · {detail.capacity === null ? "unlimited capacity" : `capacity ${formatCount(detail.capacity)}`}
              {detail.capacity !== null && ` · waitlist ${detail.waitlistEnabled ? "on" : "off"}`}
            </>
          )}
          <span className="block text-xs text-secondary">
            {detail.deadline ? (
              <>
                Closes {formatInZone(detail.deadline, detail.timezone, { weekday: false, zoneName: false })} ({detail.timezone})
              </>
            ) : (
              "Open until the event starts"
            )}
          </span>
        </Fact>
      </dl>

      {detail.registrationMode === "internal" && (
        <div className="flex flex-col gap-2">
          <SectionLabel>Registrations</SectionLabel>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Registered", value: formatCount(detail.registeredCount) },
              { label: "Waitlisted", value: formatCount(detail.waitlistCount) },
              { label: "Spots left", value: detail.spotsLeft === null ? "No limit" : formatCount(detail.spotsLeft) },
            ].map((s) => (
              <div key={s.label} className="flex flex-col rounded-[10px] border border-line px-3 py-2">
                <span className="text-xs text-secondary">{s.label}</span>
                <span className="text-md font-semibold text-ink">{s.value}</span>
              </div>
            ))}
          </div>
          {registrations && registrations !== "forbidden" && registrations.items.length > 0 && (
            <ul className="flex flex-col gap-1.5" aria-label="Latest registrations">
              {registrations.items.map((r) => (
                <li key={r.member.id} className="flex items-center gap-2 text-sm">
                  <Avatar name={r.member.name} size={24} tone={r.member.tone} src={r.member.avatarUrl ?? undefined} />
                  <span className="min-w-0 flex-1 truncate text-ink">{r.member.name}</span>
                  <span className="text-xs text-secondary">
                    {r.status === "waitlisted" ? `Waitlist #${r.position}` : r.status === "attended" ? "Attended" : "Registered"}
                  </span>
                </li>
              ))}
              {registrations.more && <li className="text-xs text-secondary">and more</li>}
            </ul>
          )}
          {registrations === "forbidden" && (
            <p className="text-xs text-secondary">Only admins with host powers can see who registered.</p>
          )}
        </div>
      )}

      {detail.description && (
        <div className="flex flex-col gap-1.5">
          <SectionLabel>Description</SectionLabel>
          <div className="flex max-h-56 flex-col gap-2.5 overflow-y-auto rounded-[10px] border border-line bg-surface p-3 text-sm break-words text-ink">
            <Description text={detail.description} />
          </div>
        </div>
      )}

      {detail.speakers.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <SectionLabel>{`Speakers (${detail.speakers.length})`}</SectionLabel>
          <ul className="flex flex-col gap-2">
            {detail.speakers.map((s, i) => (
              <li key={`${s.name}-${i}`} className="flex items-center gap-2.5">
                <Avatar name={s.name} size={32} tone={s.member?.tone ?? "tint"} src={s.avatarUrl ?? undefined} />
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="truncate text-sm font-medium text-ink">
                    {s.name}
                    {s.member && <span className="font-normal text-secondary"> · @{s.member.handle}</span>}
                  </span>
                  {(s.title || s.organisation) && (
                    <span className="truncate text-xs text-secondary">{[s.title, s.organisation].filter(Boolean).join(", ")}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <SectionLabel>Agenda</SectionLabel>
        {detail.agenda.length === 0 ? (
          <p className="text-sm text-secondary">No agenda added.</p>
        ) : (
          <ol className="flex flex-col">
            {detail.agenda.map((item, i) => (
              <li key={`${item.startsAt}-${i}`} className="flex gap-3 border-t border-line py-2 first:border-t-0 first:pt-0">
                <span className="w-[92px] shrink-0 text-xs text-secondary tabular-nums">
                  {formatClock(item.startsAt, detail.timezone)}
                  {item.endsAt ? `–${formatClock(item.endsAt, detail.timezone)}` : ""}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm text-ink">{item.title}</span>
                  {item.description && <span className="text-xs text-secondary">{item.description}</span>}
                  {item.speakerNames.length > 0 && <span className="text-xs text-secondary">{item.speakerNames.join(", ")}</span>}
                </span>
              </li>
            ))}
          </ol>
        )}
        {detail.agenda.length > 0 && <p className="text-xs text-secondary">Times in {detail.timezone}.</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <SectionLabel>History</SectionLabel>
        <ol className="flex flex-col gap-2">
          {history.map((h, i) => (
            <li key={`${h.title}-${i}`} className="flex gap-2.5">
              <span
                className={cn(
                  "mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full",
                  h.tone === "error" ? "bg-error-light text-error" : h.tone === "success" ? "bg-success-light text-success" : "bg-muted text-secondary",
                )}
              >
                <Icon name={h.icon} size={12} />
              </span>
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="text-sm text-ink">
                  {h.title}
                  {h.by && <span className="text-secondary"> by {h.by.name}</span>}
                </p>
                <p className="text-xs text-secondary">
                  <DateTime iso={h.at} />
                </p>
                {h.note && <p className="rounded-md bg-muted px-2.5 py-1.5 text-sm break-words text-body">“{h.note}”</p>}
              </div>
            </li>
          ))}
        </ol>
      </div>

      <Divider />

      <div className="flex flex-col gap-2.5">
        <SectionLabel>Action</SectionLabel>
        {!canReview ? (
          <p className="text-sm text-secondary">Your role can view events but not review them.</p>
        ) : actions.length === 0 ? (
          <p className="text-sm text-secondary">
            {detail.status === "changes_requested"
              ? "Waiting for the host to make changes and submit again."
              : detail.status === "rejected"
                ? "Rejected. The host can edit and resubmit; it will come back to the queue."
                : detail.status === "unpublished"
                  ? "Unpublished. If the host resubmits, it comes back to the queue."
                  : detail.cancelledAt
                    ? "This event was cancelled by its host. Nothing to review."
                    : detail.status === "archived" || detail.past
                      ? "This event has ended. Its page stays public with the description and agenda."
                      : "There’s nothing to do on this event."}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {actions.map((a) => (
              <button key={a.action} type="button" disabled={busy} className={actionClasses[a.style]} onClick={() => onAction(a.action)}>
                {a.label}
              </button>
            ))}
          </div>
        )}
        {canReview && pendingReview && !canFeature && (
          <p className="text-xs text-secondary">Featuring events needs a Platform Admin.</p>
        )}
      </div>

      <p className="flex items-center gap-2 rounded-lg bg-info-light p-3 text-xs text-body">
        <Icon name="alert" size={16} className="shrink-0 text-info" />
        Notes and reasons are sent to the host and kept in the audit log.
      </p>
    </section>
  );
}
