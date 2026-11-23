"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  ClaudeContentSettings,
  ContentCalendarAction,
  ContentCalendarCounts,
  ContentCalendarItem,
  ContentCalendarKind,
  ContentCalendarPage,
} from "@chartermission/contracts";
import { Button, Chip, FilterSelect, Icon, SegmentedControl, cn } from "@chartermission/ui";
import { BulkBar } from "@/components/bulk/bulk-bar";
import { runBulk } from "@/components/bulk/run-bulk";
import { useSelection } from "@/components/bulk/use-selection";
import { inputClasses } from "@/components/form-field";
import { ReasonDialog } from "@/components/reason-dialog";
import { EmptyState } from "@/components/states";
import { useNow } from "@/components/time";
import { toast } from "@/components/toast";
import { api, errorMessage } from "@/lib/api/client";
import { useIntlTag, useT } from "@/i18n/client";
import { ActionDialog } from "./action-dialog";
import { CalendarList } from "./calendar-list";
import { MonthView, WeekView } from "./calendar-views";
import { ItemDrawer } from "./item-drawer";
import { ReviewMode } from "./review-mode";
import { STATES, addDays, dayKey, fromKey, rangeFor, searchFor, startOfWeek, type CalendarParams, type CalendarView, type SourceFilter, type StateFilter } from "./shared";

type BulkAction = "hold" | "release" | "approve" | "decline" | "cancel";

const BULK: { action: BulkAction; label: string; done: string; title: string; description: string; note: "optional" | "required" }[] = [
  { action: "hold", label: "Hold", done: "{count} posts put on hold.", title: "Hold the selected posts?", description: "They won’t be published until someone on the team releases them. Each author is told.", note: "optional" },
  { action: "release", label: "Release", done: "{count} posts released.", title: "Release the selected posts?", description: "They will be published at their scheduled times. Each author is told.", note: "optional" },
  { action: "approve", label: "Approve", done: "{count} posts approved.", title: "Approve the selected posts?", description: "Posts go live now; scheduled posts go out at their time. Each author is told.", note: "optional" },
  { action: "decline", label: "Decline", done: "{count} posts declined.", title: "Decline the selected posts?", description: "They won’t be published. Each author is told, with your note.", note: "required" },
  { action: "cancel", label: "Cancel", done: "{count} scheduled posts cancelled.", title: "Cancel the selected scheduled posts?", description: "They won’t be published and go back to their authors’ drafts. Each author is told, with your note.", note: "required" },
];

/**
 * Content calendar: posts members write and schedule with Claude, by month, week or as a list,
 * with the review mode, filters, a detail drawer and batch actions. What it shows is kept in the URL.
 */
export function ContentCalendar({
  initial,
  canAct,
  canManageSettings,
  approval: initialApproval,
}: {
  initial: CalendarParams;
  canAct: boolean;
  canManageSettings: boolean;
  approval: ClaudeContentSettings["approval"];
}) {
  const t = useT();
  const tag = useIntlTag();
  const router = useRouter();
  const now = useNow();
  const [params, setParams] = useState<CalendarParams>(initial);
  const [search, setSearch] = useState(initial.q);
  const [approval, setApproval] = useState(initialApproval);
  const [page, setPage] = useState<ContentCalendarPage | null>(null);
  const [counts, setCounts] = useState<ContentCalendarCounts | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [open, setOpen] = useState<{ kind: ContentCalendarKind; id: string } | null>(null);
  const [rowAction, setRowAction] = useState<{ item: ContentCalendarItem; action: ContentCalendarAction } | null>(null);
  const [bulk, setBulk] = useState<(typeof BULK)[number] | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const selection = useSelection();
  const [authorName, setAuthorName] = useState<string | null>(null);

  const today = now === null ? null : dayKey(new Date(now));
  const anchor = useMemo(() => (params.date ? fromKey(params.date) : today ? fromKey(today) : null), [params.date, today]);
  const zone = useMemo(() => (now === null ? "UTC" : Intl.DateTimeFormat().resolvedOptions().timeZone), [now]);

  const update = useCallback((patch: Partial<CalendarParams>) => setParams((p) => ({ ...p, ...patch })), []);

  // Search waits for a pause in typing.
  useEffect(() => {
    const timer = setTimeout(() => update({ q: search.trim() }), 300);
    return () => clearTimeout(timer);
  }, [search, update]);

  // Keep the URL in step with what is shown.
  useEffect(() => {
    router.replace(`/content-calendar${searchFor(params)}`, { scroll: false });
  }, [params, router]);

  const monthKey = anchor ? `${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, "0")}` : null;

  useEffect(() => {
    if (!anchor) return;
    const controller = new AbortController();
    const range = rangeFor(params.view, anchor);
    const filters = { source: params.source, q: params.q || undefined, author: params.author ?? undefined };
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const [items, totals] = await Promise.all([
          api<ContentCalendarPage>("/admin/content-calendar/items", {
            query: { ...filters, state: params.state, ...(range ?? { limit: 50 }) },
            signal: controller.signal,
          }),
          api<ContentCalendarCounts>("/admin/content-calendar/counts", { query: { ...filters, tz: zone, month: monthKey ?? undefined }, signal: controller.signal }),
        ]);
        setPage(items);
        setCounts(totals);
        setApproval(totals.approval);
        const named = params.author ? items.items.find((i) => i.author.id === params.author)?.author.name : undefined;
        if (named) setAuthorName(named);
      } catch (e) {
        if (!controller.signal.aborted) setError(errorMessage(e));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // anchor is derived from params.date and today.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.view, params.state, params.source, params.q, params.author, params.date, today, zone, reload]);

  // Picked rows that are no longer listed (after a filter change) are dropped.
  useEffect(() => {
    if (page) selection.retain(page.items.map((i) => i.key));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  async function more() {
    if (!page?.nextCursor) return;
    setLoading(true);
    try {
      const next = await api<ContentCalendarPage>("/admin/content-calendar/items", {
        query: { source: params.source, q: params.q || undefined, author: params.author ?? undefined, state: params.state, limit: 50, cursor: page.nextCursor },
      });
      setPage((p) => (p ? { items: [...p.items, ...next.items], nextCursor: next.nextCursor } : next));
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setLoading(false);
    }
  }

  function shift(direction: -1 | 1) {
    if (!anchor) return;
    const next = params.view === "week" ? addDays(startOfWeek(anchor), 7 * direction) : new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1);
    update({ date: dayKey(next) });
  }

  const title = anchor
    ? params.view === "week"
      ? weekTitle(startOfWeek(anchor), tag)
      : new Intl.DateTimeFormat(tag, { month: "long", year: "numeric" }).format(anchor)
    : "";

  const items = page?.items ?? [];
  const picked = selection.list;

  return (
    <section className="flex flex-col gap-4">
      <ReviewMode mode={approval} canChange={canManageSettings} onChanged={(mode) => {
        setApproval(mode);
        setReload((n) => n + 1);
      }} />

      <SegmentedControl<StateFilter>
        label="Show posts"
        size="small"
        className="flex-wrap"
        value={params.state}
        onChange={(state) => update({ state })}
        items={[{ value: "all" as StateFilter, label: t("All") }, ...STATES.map((s) => ({ value: s.value as StateFilter, label: t(s.label) }))].map((item) => {
          const n = counts?.states[item.value];
          return { value: item.value, label: n === undefined ? item.label : `${item.label} · ${new Intl.NumberFormat(tag).format(n)}` };
        })}
      />

      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl<CalendarView>
          label="View"
          size="small"
          value={params.view}
          onChange={(view) => update({ view })}
          items={[
            { value: "month", label: t("Month") },
            { value: "week", label: t("Week") },
            { value: "list", label: t("List") },
          ]}
        />
        <FilterSelect
          label="Which posts"
          value={params.source}
          onChange={(e) => update({ source: e.target.value as SourceFilter })}
          options={[
            { value: "claude", label: t("Written with Claude") },
            { value: "all", label: t("All scheduled posts") },
          ]}
        />
        <label className="relative min-w-[220px] flex-1">
          <span className="sr-only">Search posts</span>
          <Icon name="search" size={16} className="pointer-events-none absolute inset-y-0 start-3 my-auto h-fit text-secondary" />
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search the text or the author’s name" className={inputClasses(false, "ps-9")} />
        </label>
        {params.author && (
          <Chip tone="filter" className="gap-1.5">
            {authorName ? t("Author: {name}", { name: authorName }) : t("One author")}
            <button type="button" onClick={() => update({ author: null })} className="rounded text-secondary hover:text-ink">
              <Icon name="x" size={14} label="Show every author" />
            </button>
          </Chip>
        )}
      </div>

      {params.view !== "list" && anchor && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="small" onClick={() => shift(-1)} aria-label={params.view === "week" ? t("Previous week") : t("Previous month")}>
            <Icon name="chevron-left" size={16} className="rtl:rotate-180" />
          </Button>
          <Button variant="secondary" size="small" onClick={() => shift(1)} aria-label={params.view === "week" ? t("Next week") : t("Next month")}>
            <Icon name="chevron-right" size={16} className="rtl:rotate-180" />
          </Button>
          <Button variant="ghost" size="small" onClick={() => update({ date: null })} disabled={!params.date || params.date === today}>
            Today
          </Button>
          <h2 className="ms-1 text-h3 text-ink" aria-live="polite">
            {title}
          </h2>
          <span className="ms-auto text-xs text-secondary">{t("Times in {zone}. Point at an item for UTC.", { zone })}</span>
        </div>
      )}

      <div className={cn("flex flex-col gap-3", loading && "opacity-70")} aria-busy={loading}>
        {!anchor ? (
          <div className="h-[420px] animate-pulse rounded-card border border-line bg-card" aria-label="Loading the calendar" />
        ) : error ? (
          <p role="alert" className="rounded-card border border-line bg-card px-5 py-6 text-sm text-error">
            {error}
          </p>
        ) : params.view === "list" ? (
          items.length === 0 && !loading ? (
            <div className="rounded-card border border-line bg-card">
              <Empty filtered={params.state !== "all" || !!params.q || !!params.author} />
            </div>
          ) : (
            <CalendarList items={items} canAct={canAct} selection={selection} onOpen={(i) => setOpen({ kind: i.kind, id: i.id })} onAction={(item, action) => setRowAction({ item, action })} />
          )
        ) : params.view === "week" ? (
          <WeekView anchor={anchor} today={today!} items={items} onOpen={(i) => setOpen({ kind: i.kind, id: i.id })} />
        ) : (
          <MonthView anchor={anchor} today={today!} items={items} onOpen={(i) => setOpen({ kind: i.kind, id: i.id })} onShowDay={(day) => update({ view: "week", date: day })} />
        )}
        {params.view !== "list" && anchor && !error && !loading && items.length === 0 && (
          <div className="rounded-card border border-line bg-card">
            <Empty filtered={params.state !== "all" || !!params.q || !!params.author} period />
          </div>
        )}
        {params.view === "list" && page?.nextCursor && (
          <div className="flex justify-center">
            <Button variant="secondary" size="small" disabled={loading} onClick={() => void more()}>
              {loading ? "Loading…" : "Load more"}
            </Button>
          </div>
        )}
      </div>

      {canAct && params.view === "list" && (
        <BulkBar count={selection.count} busy={bulkBusy} onClear={selection.clear}>
          {BULK.map((b) => (
            <Button key={b.action} variant="ghost" size="small" disabled={bulkBusy} onClick={() => setBulk(b)} className={b.note === "required" ? "text-error" : undefined}>
              {b.label}
            </Button>
          ))}
        </BulkBar>
      )}

      {bulk && (
        <ReasonDialog
          title={bulk.title}
          description={bulk.description}
          confirmLabel={bulk.label}
          tone={bulk.note === "required" ? "danger" : "primary"}
          reasonField={bulk.note}
          reasonLabel="Note to the authors"
          reasonPlaceholder="Each author sees this in their notification and email"
          reasonHint="Sent to each author and kept in the audit log."
          minReasonLength={5}
          onConfirm={async (reason) => {
            setBulkBusy(true);
            const chosen = picked.map((key) => {
              const [kind, id] = key.split(":") as [ContentCalendarKind, string];
              return { kind, id };
            });
            const result = await runBulk("/admin/content-calendar/bulk", { items: chosen, action: bulk.action, note: reason.trim() || undefined }, t, bulk.done);
            setBulkBusy(false);
            if (result) {
              selection.remove(result.done);
              setBulk(null);
              setReload((n) => n + 1);
            }
          }}
          onClose={() => setBulk(null)}
        />
      )}

      {rowAction && (
        <ActionDialog
          kind={rowAction.item.kind}
          id={rowAction.item.id}
          action={rowAction.action}
          scheduledFor={rowAction.item.scheduledFor}
          onDone={() => {
            setRowAction(null);
            setReload((n) => n + 1);
          }}
          onClose={() => setRowAction(null)}
        />
      )}

      {open && (
        <ItemDrawer
          key={`${open.kind}:${open.id}`}
          item={open}
          canAct={canAct}
          onClose={() => setOpen(null)}
          onChanged={() => setReload((n) => n + 1)}
          onOnlyAuthor={(author) => {
            setOpen(null);
            update({ author });
          }}
        />
      )}
    </section>
  );
}

function weekTitle(start: Date, tag: string): string {
  const end = addDays(start, 6);
  return new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", year: "numeric" }).formatRange(start, end);
}

/** Where items come from, when there are none to show. */
function Empty({ filtered, period }: { filtered: boolean; period?: boolean }) {
  if (filtered) {
    return (
      <EmptyState icon="search" title="Nothing matches these filters">
        Try another state, clear the search or show every author.
      </EmptyState>
    );
  }
  return (
    <EmptyState icon="calendar" title={period ? "No posts in this period" : "No posts written with Claude yet"}>
      <p>
        Posts appear here when members write or schedule them with Claude. Members connect Claude from Settings → Connected apps on the member site, once they have access.
      </p>
      <p className="mt-2">
        Give access in{" "}
        <Link href="/members" className="font-medium text-primary-light hover:underline">
          Members → Claude
        </Link>
        .
      </p>
    </EmptyState>
  );
}
