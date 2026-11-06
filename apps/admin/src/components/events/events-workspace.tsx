"use client";

import { useEffect, useId, useOptimistic, useRef, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  EVENT_FORMAT_LABELS,
  type AdminEventRow,
  type EventDetail,
  type FeatureEventInput,
  type Page,
  type ReviewDecisionInput,
  type UnpublishEventInput,
} from "@chartermission/contracts";
import { Button, Chip, FilterSelect, Icon, cn } from "@chartermission/ui";
import { FormNotice, inputClasses } from "@/components/form-field";
import { ReasonDialog } from "@/components/reason-dialog";
import { SkeletonBar, SkeletonCard, SkeletonTable } from "@/components/skeletons";
import { EmptyState } from "@/components/states";
import { Age, useNow } from "@/components/time";
import { toast } from "@/components/toast";
import { api, errorMessage, isApiError } from "@/lib/api/client";
import {
  EVENT_AGES,
  EVENT_SORTS,
  EVENT_TABS,
  eventStatusChip,
  eventsApiQuery,
  eventsSearch,
  type EventRegistrationsPreview,
  type EventSort,
  type EventsView,
} from "@/lib/events-view";
import { formatInZone } from "@/lib/zoned-time";
import { EventReviewPanel, hostName, type EventAction } from "./event-review-panel";

type More = { base: string | null; rows: AdminEventRow[]; cursor: string | null };

/** Fields an action changes, applied over server data until the refresh lands (or rolled back). */
export type EventPatch = Partial<Pick<AdminEventRow, "status" | "featured" | "reviewNote" | "reviewedAt" | "reviewedBy">>;

const ACTION_COPY: Record<
  EventAction,
  {
    title: string;
    confirmLabel: string;
    tone: "primary" | "danger";
    reasonField: "required" | "optional" | "none";
    reasonLabel?: string;
    placeholder?: string;
    hint?: string;
    required?: string;
    description: string;
    done: string;
  }
> = {
  approve: {
    title: "Approve and publish this event?",
    confirmLabel: "Approve and publish",
    tone: "primary",
    reasonField: "optional",
    reasonLabel: "Note to the host",
    placeholder: "Anything the host should know (sent with the approval)",
    hint: "Sent to the host with the approval and kept in the audit log.",
    description: "It goes live on the Events page straight away and the host is notified.",
    done: "Event approved and published. The host has been notified.",
  },
  request_changes: {
    title: "Request changes",
    confirmLabel: "Send to host",
    tone: "primary",
    reasonField: "required",
    reasonLabel: "What should the host change?",
    placeholder: "e.g. Add the venue address and a short agenda before we list this",
    hint: "Sent to the host. They can edit the event and submit it again.",
    required: "Tell the host what to change.",
    description: "The event stays unlisted until the host edits it and submits it again.",
    done: "Changes requested. The host has been sent your note.",
  },
  reject: {
    title: "Reject this event?",
    confirmLabel: "Reject event",
    tone: "danger",
    reasonField: "required",
    reasonLabel: "Reason for rejecting",
    placeholder: "Explain why this event can’t be listed",
    hint: "Sent to the host and kept in the audit log.",
    required: "A reason is required. It is sent to the host.",
    description: "The event won’t be listed. The host is told why and can still edit and resubmit it.",
    done: "Event rejected. The host has been sent your reason.",
  },
  unpublish: {
    title: "Unpublish this event?",
    confirmLabel: "Unpublish",
    tone: "danger",
    reasonField: "required",
    reasonLabel: "Reason for unpublishing",
    placeholder: "Explain why the event is coming down",
    hint: "Sent to the host and kept in the audit log.",
    required: "A reason is required. It is sent to the host.",
    description:
      "It disappears from event lists and its page at once. Registrations are kept; the host can fix the event and submit it again.",
    done: "Event unpublished. It no longer appears to members.",
  },
  feature: {
    title: "Feature this event?",
    confirmLabel: "Feature event",
    tone: "primary",
    reasonField: "none",
    description: "Featured events are highlighted on the Events page and home widgets.",
    done: "Event featured.",
  },
  unfeature: {
    title: "Stop featuring this event?",
    confirmLabel: "Unfeature",
    tone: "primary",
    reasonField: "none",
    description: "It stays published but is no longer highlighted.",
    done: "Event no longer featured.",
  },
};

/** Optimistic outcome of an action. */
function patchFor(action: EventAction, note: string): EventPatch {
  const now = new Date().toISOString();
  switch (action) {
    case "approve":
      return { status: "published", reviewedAt: now, reviewNote: note || null };
    case "request_changes":
      return { status: "changes_requested", reviewedAt: now, reviewNote: note };
    case "reject":
      return { status: "rejected", reviewedAt: now, reviewNote: note };
    case "unpublish":
      return { status: "unpublished", reviewNote: note };
    case "feature":
      return { featured: true };
    case "unfeature":
      return { featured: false };
  }
}

function SortHeader({
  label,
  active,
  direction,
  onClick,
  className,
}: {
  label: string;
  active: boolean;
  direction: "ascending" | "descending";
  onClick: () => void;
  className?: string;
}) {
  return (
    <th scope="col" aria-sort={active ? direction : "none"} className={cn("py-3 pr-3 font-semibold", className)}>
      <button type="button" onClick={onClick} className="inline-flex items-center gap-1 rounded-sm uppercase hover:text-ink">
        {label}
        <Icon
          name="chevron-down"
          size={12}
          className={cn("transition-transform", !active && "opacity-30", active && direction === "ascending" && "rotate-180")}
        />
        <span className="sr-only">{active ? `, sorted ${direction}` : ", sortable"}</span>
      </button>
    </th>
  );
}

/**
 * Events review queue: status tabs, search / age / sort, the event table and the review panel.
 * The view and the selected event live in the URL; the server renders the first page and the
 * selected event. Actions confirm in a dialog, apply optimistically and roll back on failure.
 */
export function EventsWorkspace({
  view,
  initialRows,
  initialCursor,
  selectedId,
  detail,
  detailError,
  registrations,
  canReview,
  canFeature,
}: {
  view: EventsView;
  initialRows: AdminEventRow[];
  initialCursor: string | null;
  selectedId: string | null;
  detail: EventDetail | null;
  detailError: string | null;
  registrations: EventRegistrationsPreview;
  canReview: boolean;
  canFeature: boolean;
}) {
  const router = useRouter();
  const ids = useId();
  const [navigating, startNavigation] = useTransition();
  const [optimisticSelected, setOptimisticSelected] = useOptimistic(selectedId);
  const [more, setMore] = useState<More | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [patches, setPatches] = useState<Record<string, EventPatch>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [pending, setPending] = useState<{ action: EventAction; event: Pick<AdminEventRow, "id" | "title"> } | null>(null);
  const [query, setQuery] = useState(view.q ?? "");
  const detailRef = useRef<HTMLDivElement>(null);
  const lastDetailId = useRef<string | null>(detail?.id ?? null);
  const hydrated = useNow() !== null;

  const extra = more && more.base === initialCursor ? more : null;
  const cursor = extra ? extra.cursor : initialCursor;
  const seen = new Set<string>();
  const rows = [...initialRows, ...(extra?.rows ?? [])]
    .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
    .map((r) => (patches[r.id] ? { ...r, ...patches[r.id] } : r));
  const selectedRow = detail ? (rows.find((r) => r.id === detail.id) ?? null) : null;
  const shownDetail = detail && patches[detail.id] ? { ...detail, ...patches[detail.id] } : detail;

  // On narrow screens the panel sits under the table: bring it into view when a new event loads.
  useEffect(() => {
    const id = detail?.id ?? null;
    if (id && id !== lastDetailId.current && window.matchMedia("(max-width: 1279px)").matches) {
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    lastDetailId.current = id;
  }, [detail?.id]);

  function navigate(next: EventsView, eventId?: string | null) {
    startNavigation(() => {
      if (eventId !== undefined) setOptimisticSelected(eventId);
      router.push(`/events${eventsSearch(next, eventId)}`, { scroll: false });
    });
  }

  function select(id: string) {
    if (id === optimisticSelected && detail?.id === id) return;
    navigate(view, id);
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    navigate({ ...view, q: query.trim() || undefined }, null);
  }

  function sortBy(column: "submitted" | "starts") {
    const next: EventSort = column === "starts" ? "starts_soon" : view.sort === "oldest" ? "newest" : "oldest";
    navigate({ ...view, sort: next }, selectedId);
  }

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    setLoadError(null);
    try {
      const page = await api<Page<AdminEventRow>>("/admin/events", { query: eventsApiQuery(view, cursor) });
      setMore({ base: initialCursor, rows: [...(extra?.rows ?? []), ...page.items], cursor: page.nextCursor });
    } catch (e) {
      setLoadError(errorMessage(e));
    } finally {
      setLoadingMore(false);
    }
  }

  /** Confirmed in the dialog: apply at once, call the API, keep the event selected, roll back on failure. */
  async function run(action: EventAction, event: Pick<AdminEventRow, "id" | "title">, note: string) {
    const previous = patches[event.id];
    const copy = ACTION_COPY[action];
    setPending(null);
    setSaving(event.id);
    setPatches((p) => ({ ...p, [event.id]: { ...p[event.id], ...patchFor(action, note) } }));
    try {
      let row: AdminEventRow;
      if (action === "approve" || action === "request_changes" || action === "reject") {
        const body: ReviewDecisionInput = { decision: action, note };
        row = await api<AdminEventRow>(`/admin/events/${event.id}/review`, { method: "POST", body });
      } else if (action === "unpublish") {
        const body: UnpublishEventInput = { reason: note };
        row = await api<AdminEventRow>(`/admin/events/${event.id}/unpublish`, { method: "POST", body });
      } else {
        const body: FeatureEventInput = { featured: action === "feature" };
        row = await api<AdminEventRow>(`/admin/events/${event.id}/featured`, { method: "PUT", body });
      }
      setPatches((p) => ({
        ...p,
        [event.id]: {
          status: row.status,
          featured: row.featured,
          reviewNote: row.reviewNote,
          reviewedAt: row.reviewedAt,
          reviewedBy: row.reviewedBy,
        },
      }));
      toast(copy.done);
      startNavigation(() => {
        if (event.id !== selectedId) router.replace(`/events${eventsSearch(view, event.id)}`, { scroll: false });
        else router.refresh();
      });
    } catch (e) {
      setPatches((p) => {
        const next = { ...p };
        if (previous) next[event.id] = previous;
        else delete next[event.id];
        return next;
      });
      const message = isApiError(e, "FORBIDDEN")
        ? "Your role can’t do that. Ask a Platform Admin if you need it."
        : isApiError(e, "CONFLICT")
          ? `${errorMessage(e)} The list has been refreshed.`
          : errorMessage(e);
      toast(`“${event.title}” wasn’t changed. ${message}`, "error");
      if (isApiError(e, "CONFLICT") || isApiError(e, "NOT_FOUND")) startNavigation(() => router.refresh());
    } finally {
      setSaving(null);
    }
  }

  const tabLabel = EVENT_TABS.find((t) => t.value === view.tab)?.label ?? "";
  const filtered = !!view.q || !!view.olderThanHours;
  const detailBusy = (navigating && optimisticSelected !== detail?.id) || saving === detail?.id;
  const copy = pending ? ACTION_COPY[pending.action] : null;

  return (
    <>
      <nav aria-label="Event status" className="-mb-1 overflow-x-auto">
        <ul className="flex gap-6 border-b border-line">
          {EVENT_TABS.map((tab) => {
            const isActive = tab.value === view.tab;
            return (
              <li key={tab.value} className="shrink-0">
                <Link
                  href={`/events${eventsSearch({ ...view, tab: tab.value })}`}
                  scroll={false}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "-mb-px flex flex-col gap-2.5 rounded-sm pt-1 text-md whitespace-nowrap transition-colors",
                    isActive ? "font-medium text-primary" : "text-secondary hover:text-ink",
                  )}
                >
                  {tab.label}
                  <span aria-hidden="true" className={cn("h-[3px] w-full", isActive && "bg-accent")} />
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div role="group" aria-label="Filter events" aria-busy={navigating} className="flex flex-wrap items-center gap-2">
        <form role="search" onSubmit={submitSearch} className="relative flex min-w-[240px] flex-1 items-center sm:max-w-[340px]">
          <label htmlFor={`${ids}-q`} className="sr-only">
            Search events by title or summary
          </label>
          <Icon name="search" size={16} className="pointer-events-none absolute left-2.5 text-secondary" />
          <input
            id={`${ids}-q`}
            type="search"
            value={query}
            maxLength={100}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title or summary"
            className={inputClasses(false, "py-1.5 pr-3 pl-8")}
          />
        </form>
        <FilterSelect
          label="Waiting time"
          options={EVENT_AGES}
          value={view.olderThanHours ? String(view.olderThanHours) : ""}
          onChange={(e) => navigate({ ...view, olderThanHours: e.target.value ? Number(e.target.value) : undefined }, null)}
        />
        <FilterSelect
          label="Sort"
          options={EVENT_SORTS}
          value={view.sort}
          onChange={(e) => navigate({ ...view, sort: e.target.value as EventSort }, selectedId)}
        />
        {filtered && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              navigate({ tab: view.tab, sort: view.sort }, null);
            }}
            className="rounded-md px-2 py-1 text-sm font-medium text-primary hover:bg-primary-tint-2"
          >
            Clear filters
          </button>
        )}
      </div>

      <div
        className={cn(
          "grid grid-cols-[minmax(0,1fr)] items-start gap-5",
          (rows.length > 0 || detail || detailError) && "xl:grid-cols-[minmax(0,1fr)_440px]",
        )}
      >
        <div className="flex min-w-0 flex-col gap-3">
          <div className={cn("relative overflow-hidden rounded-card border border-line bg-card transition-opacity", navigating && "opacity-80")}>
            {rows.length === 0 ? (
              <EmptyState icon={view.tab === "queue" && !filtered ? "check" : "calendar"} title={view.tab === "queue" && !filtered ? "Nothing waiting for review" : `No ${tabLabel.toLowerCase()} events${filtered ? " match these filters" : ""}`}>
                {view.tab === "queue" && !filtered
                  ? "Events submitted by hosts and chapters appear here, oldest first."
                  : filtered
                    ? "Try a different search or clear the filters."
                    : "Events move here as their status changes."}
              </EmptyState>
            ) : (
              <>
                <table className="hidden w-full table-fixed border-collapse text-left md:table">
                  <caption className="sr-only">{tabLabel} events. Select a row to review it.</caption>
                  <colgroup>
                    <col />
                    <col className="w-[168px]" />
                    <col className="w-[148px]" />
                    <col className="w-[104px]" />
                  </colgroup>
                  <thead className="bg-muted text-label text-secondary uppercase">
                    <tr>
                      <th scope="col" className="py-3 pr-3 pl-4 font-semibold">
                        Event
                      </th>
                      <SortHeader
                        label="Starts"
                        active={view.sort === "starts_soon"}
                        direction="ascending"
                        onClick={() => sortBy("starts")}
                      />
                      <th scope="col" className="py-3 pr-3 font-semibold">
                        Status
                      </th>
                      <SortHeader
                        label="Submitted"
                        className="pr-4"
                        active={view.sort !== "starts_soon"}
                        direction={view.sort === "newest" ? "descending" : "ascending"}
                        onClick={() => sortBy("submitted")}
                      />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const isSelected = row.id === optimisticSelected;
                      const chip = eventStatusChip(row);
                      return (
                        <tr
                          key={row.id}
                          onClick={() => select(row.id)}
                          className={cn(
                            "cursor-pointer border-t border-line text-sm transition-colors first:border-t-0",
                            isSelected ? "bg-primary-tint-2" : "hover:bg-surface",
                            saving === row.id && "opacity-70",
                          )}
                        >
                          <td className="py-3 pr-3 pl-4">
                            <button
                              type="button"
                              aria-pressed={isSelected}
                              aria-controls={`${ids}-detail`}
                              onClick={(event) => {
                                event.stopPropagation();
                                select(row.id);
                              }}
                              className="flex w-full min-w-0 flex-col rounded-sm text-left"
                            >
                              <span className="flex min-w-0 items-center gap-1.5">
                                <span className="truncate font-medium text-ink">{row.title}</span>
                                {row.featured && (
                                  <Icon name="flame" size={14} className="shrink-0 text-accent" label="Featured" />
                                )}
                              </span>
                              <span className="truncate text-xs text-secondary">
                                {row.format === "online" ? "Online" : `${EVENT_FORMAT_LABELS[row.format]} · ${row.location.shortLabel}`} · {hostName(row.host)}
                              </span>
                            </button>
                          </td>
                          <td className="py-3 pr-3 text-body">
                            <span className="block truncate">
                              {formatInZone(row.startsAt, row.timezone, { weekday: false, zoneName: false })}
                            </span>
                            <span className="block truncate text-xs text-secondary">{row.timezone}</span>
                          </td>
                          <td className="py-3 pr-3">
                            <Chip tone={chip.tone} className="max-w-full truncate px-2.5! py-0.5! text-xs!">
                              {chip.label}
                            </Chip>
                          </td>
                          <td className="py-3 pr-4 text-secondary">
                            {row.submittedAt ? <Age iso={row.submittedAt} /> : <span aria-label="Not submitted">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                <ul className="flex flex-col md:hidden" aria-label={`${tabLabel} events`}>
                  {rows.map((row) => {
                    const isSelected = row.id === optimisticSelected;
                    const chip = eventStatusChip(row);
                    return (
                      <li key={row.id} className="border-t border-line first:border-t-0">
                        <button
                          type="button"
                          aria-pressed={isSelected}
                          aria-controls={`${ids}-detail`}
                          onClick={() => select(row.id)}
                          className={cn("flex w-full flex-col gap-1.5 px-4 py-3 text-left", isSelected ? "bg-primary-tint-2" : "hover:bg-surface")}
                        >
                          <span className="flex items-center justify-between gap-2 text-xs text-secondary">
                            <span className="truncate">
                              {EVENT_FORMAT_LABELS[row.format]} · {hostName(row.host)}
                            </span>
                            {row.submittedAt && <Age iso={row.submittedAt} />}
                          </span>
                          <span className="line-clamp-2 text-sm font-medium text-ink">{row.title}</span>
                          <span className="flex flex-wrap items-center gap-2 text-xs text-secondary">
                            <Chip tone={chip.tone} className="px-2! py-0.5! text-xs!">
                              {chip.label}
                            </Chip>
                            {formatInZone(row.startsAt, row.timezone, { weekday: false, zoneName: false })} ({row.timezone})
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
          {loadError && <FormNotice tone="error">{loadError}</FormNotice>}
          {cursor && (
            <div className="flex justify-center">
              <Button variant="secondary" size="small" onClick={loadMore} disabled={loadingMore} aria-busy={loadingMore}>
                {loadingMore ? "Loading…" : "Load more events"}
              </Button>
            </div>
          )}
        </div>

        <div ref={detailRef} className="scroll-mt-20 xl:sticky xl:top-[80px] xl:max-h-[calc(100dvh-100px)] xl:overflow-y-auto xl:rounded-card">
          {shownDetail ? (
            <EventReviewPanel
              id={`${ids}-detail`}
              detail={shownDetail}
              row={selectedRow}
              registrations={registrations}
              canReview={canReview}
              canFeature={canFeature}
              busy={detailBusy}
              hydrated={hydrated}
              onAction={(action) => setPending({ action, event: { id: shownDetail.id, title: shownDetail.title } })}
            />
          ) : detailError ? (
            <div id={`${ids}-detail`} className="rounded-card border border-line bg-card">
              <EmptyState icon="alert" title="This event couldn’t be opened">
                {detailError}
              </EmptyState>
            </div>
          ) : rows.length > 0 ? (
            <div id={`${ids}-detail`} className="rounded-card border border-line bg-card">
              <EmptyState icon="calendar" title="Select an event">
                Choose an event to see its details, host, registrations and review history.
              </EmptyState>
            </div>
          ) : null}
        </div>
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {navigating ? "Loading" : saving ? "Saving" : ""}
      </p>

      {pending && copy && (
        <ReasonDialog
          title={copy.title}
          description={
            <>
              <p className="mb-1 line-clamp-2 font-medium text-ink">{pending.event.title}</p>
              <p>{copy.description}</p>
            </>
          }
          confirmLabel={copy.confirmLabel}
          tone={copy.tone}
          reasonField={copy.reasonField}
          reasonLabel={copy.reasonLabel}
          reasonPlaceholder={copy.placeholder}
          reasonHint={copy.hint}
          requiredMessage={copy.required}
          minReasonLength={5}
          onConfirm={(note) => {
            void run(pending.action, pending.event, note);
          }}
          onClose={() => setPending(null)}
        />
      )}
    </>
  );
}

export function EventsWorkspaceSkeleton() {
  return (
    <>
      <div className="flex gap-6 border-b border-line pb-3" aria-hidden="true">
        {Array.from({ length: 7 }, (_, i) => (
          <SkeletonBar key={i} className="h-5 w-24" />
        ))}
      </div>
      <div className="flex flex-wrap gap-2" aria-hidden="true">
        <SkeletonBar className="h-8 w-[300px] rounded-lg" />
        <SkeletonBar className="h-8 w-36 rounded-lg" />
        <SkeletonBar className="h-8 w-44 rounded-lg" />
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 xl:grid-cols-[minmax(0,1fr)_440px]">
        <SkeletonTable label="Loading events" />
        <SkeletonCard lines={10} className="hidden xl:flex" />
      </div>
    </>
  );
}
