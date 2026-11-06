"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import type { EventSummary, Page } from "@chartermission/contracts";
import { Panel, SegmentedControl, buttonClasses, cn } from "@chartermission/ui";
import { ErrorNotice } from "@/components/social/errors";
import { EmptyState } from "@/components/social/skeletons";
import { api } from "@/lib/api/client";
import { EventRow } from "./event-cards";
import { eventHref } from "./event-meta";

export type MyRole = "registered" | "hosting";
export type MyWhen = "upcoming" | "past" | "all";

const roles: { value: MyRole; label: string }[] = [
  { value: "registered", label: "Registered" },
  { value: "hosting", label: "Hosting" },
];

const PAGE = 20;
const EDITABLE = new Set(["draft", "changes_requested", "rejected", "unpublished", "published"]);

function List({ initial, role, when }: { initial: Page<EventSummary>; role: MyRole; when: MyWhen }) {
  const [items, setItems] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const more = useCallback(async () => {
    if (!cursor) return;
    setLoading(true);
    setError(null);
    try {
      const page = await api<Page<EventSummary>>("/me/events", { query: { role, when, cursor, limit: PAGE } });
      setItems((current) => [...current, ...page.items.filter((e) => !current.some((c) => c.id === e.id))]);
      setCursor(page.nextCursor);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [cursor, role, when]);

  if (!items.length) {
    return role === "hosting" ? (
      <EmptyState
        icon="calendar"
        title={when === "past" ? "No past events you hosted" : "You’re not hosting anything yet"}
        actions={
          <Link href="/events/new" className={buttonClasses({ variant: "accent", size: "small" })}>
            Host an event
          </Link>
        }
      >
        Drafts, events in review and published events you host appear here.
      </EmptyState>
    ) : (
      <EmptyState
        icon="calendar"
        title={when === "past" ? "No past events yet" : "No upcoming registrations"}
        actions={
          <Link href="/events" className={buttonClasses({ variant: "secondary", size: "small" })}>
            Browse events
          </Link>
        }
      >
        {when === "past" ? "Events you registered for move here after they end." : "Register for an event and it shows up here, with reminders a day and an hour before."}
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel className="overflow-hidden">
        <ul className="flex flex-col divide-y divide-line">
          {items.map((event) => (
            <li key={event.id}>
              <EventRow
                event={event}
                showLifecycle={role === "hosting" && event.status !== "published"}
                trailing={
                  role === "hosting" ? (
                    <>
                      {EDITABLE.has(event.status) && !event.past && !event.cancelledAt && (
                        <Link href={`${eventHref(event)}/edit`} className={cn(buttonClasses({ variant: "secondary", size: "small" }), "max-sm:hidden")}>
                          Edit<span className="sr-only"> {event.title}</span>
                        </Link>
                      )}
                      {event.registrationMode === "internal" && (event.status === "published" || event.status === "archived") && (
                        <Link href={`${eventHref(event)}/registrations`} className={cn(buttonClasses({ variant: "ghost", size: "small" }), "max-sm:hidden")}>
                          Registrations<span className="sr-only"> for {event.title}</span>
                        </Link>
                      )}
                    </>
                  ) : undefined
                }
              />
            </li>
          ))}
        </ul>
      </Panel>
      {error ? (
        <ErrorNotice error={error} onRetry={() => void more()} />
      ) : (
        cursor && (
          <button type="button" onClick={() => void more()} disabled={loading} className={cn(buttonClasses({ variant: "secondary", size: "small" }), "self-center")}>
            {loading ? "Loading…" : "Load more"}
          </button>
        )
      )}
    </div>
  );
}

/** My events: Registered / Hosting with Upcoming / Past (GET /me/events). */
export function MyEvents({ initial, error, role, when, canHost }: { initial: Page<EventSummary> | null; error: unknown; role: MyRole; when: MyWhen; canHost: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState({ role, when });
  const shown = pending ? target : { role, when };

  function go(next: { role: MyRole; when: MyWhen }) {
    setTarget(next);
    const params = new URLSearchParams();
    if (next.role !== "registered") params.set("role", next.role);
    if (next.when !== "upcoming") params.set("when", next.when);
    const qs = params.toString();
    startTransition(() => router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false }));
  }

  const whenItems =
    shown.role === "hosting"
      ? ([
          { value: "upcoming", label: "Upcoming" },
          { value: "past", label: "Past" },
          { value: "all", label: "All" },
        ] as const)
      : ([
          { value: "upcoming", label: "Upcoming" },
          { value: "past", label: "Past" },
        ] as const);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div role="tablist" aria-label="My events" className="flex gap-6 border-b border-line">
          {roles.filter((r) => canHost || r.value === "registered" || role === "hosting").map((r) => {
            const selected = shown.role === r.value;
            return (
              <button
                key={r.value}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls="my-events-panel"
                onClick={() => go({ role: r.value, when: r.value === "registered" && shown.when === "all" ? "upcoming" : shown.when })}
                className={cn("-mb-px border-b-2 pb-2 text-md font-medium", selected ? "border-primary text-primary" : "border-transparent text-secondary hover:text-ink")}
              >
                {r.label}
              </button>
            );
          })}
        </div>
        <SegmentedControl label="When" size="small" items={whenItems} value={shown.when} onChange={(value) => go({ role: shown.role, when: value })} />
      </div>
      <div id="my-events-panel" role="tabpanel" aria-busy={pending || undefined} className={cn("transition-opacity", pending && "opacity-60")}>
        {initial ? <List key={`${role}-${when}`} initial={initial} role={role} when={when} /> : <ErrorNotice error={error} onRetry={() => router.refresh()} />}
      </div>
    </div>
  );
}
