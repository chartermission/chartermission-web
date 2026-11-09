"use client";

import Link from "next/link";
import { useState } from "react";
import {
  APPLICATION_STATUS_LABELS,
  type ApplicationStatus,
  type ApplicationView,
  type ApplicationsPage,
  type DecideApplicationInput,
} from "@chartermission/contracts";
import { Button, Chip, Icon, Panel, cn } from "@chartermission/ui";
import { ConfirmDialog } from "@/components/social/confirm-dialog";
import { ErrorNotice } from "@/components/social/errors";
import { AuthorName, MemberAvatar, TimeAgo } from "@/components/social/post-parts";
import { EmptyState } from "@/components/social/skeletons";
import { toast } from "@/components/social/toast";
import { api } from "@/lib/api/client";
import { applicationTone } from "./opportunity-card";

type Filter = "all" | Exclude<ApplicationStatus, "withdrawn">;
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "submitted", label: "New" },
  { value: "shortlisted", label: "Shortlisted" },
  { value: "accepted", label: "Accepted" },
  { value: "declined", label: "Not selected" },
];

type Decision = { app: ApplicationView; status: "accepted" | "declined" };

/** The poster's applicant list: filter by status; shortlist, accept or decline with an optional message. */
export function ApplicantsView({ opportunityId, title, initial }: { opportunityId: string; title: string; initial: ApplicationsPage }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [message, setMessage] = useState("");

  async function load(next: Filter, cursor?: string) {
    setLoading(true);
    setError(null);
    try {
      const result = await api<ApplicationsPage>(`/opportunities/${opportunityId}/applications`, {
        query: { status: next === "all" ? undefined : next, cursor },
      });
      setPage((current) => (cursor ? { ...result, items: [...current.items, ...result.items] } : result));
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }

  function choose(next: Filter) {
    setFilter(next);
    void load(next);
  }

  async function decide(app: ApplicationView, input: DecideApplicationInput) {
    await api(`/opportunities/${opportunityId}/applications/${app.id}`, { method: "PATCH", body: input });
    const counts = { ...page.counts, [app.status]: page.counts[app.status] - 1, [input.status]: page.counts[input.status] + 1 };
    setPage((current) => ({
      ...current,
      counts,
      items: current.items
        .map((a) => (a.id === app.id ? { ...a, status: input.status } : a))
        .filter((a) => filter === "all" || a.status === filter),
    }));
    toast.success(
      input.status === "shortlisted"
        ? `${app.applicant.name} shortlisted`
        : input.status === "accepted"
          ? `${app.applicant.name} accepted. We’ve let them know.`
          : input.status === "declined"
            ? `We’ve let ${app.applicant.name} know`
            : "Moved back to new",
    );
  }

  const total = page.counts.submitted + page.counts.shortlisted + page.counts.accepted + page.counts.declined;
  const countOf = (f: Filter) => (f === "all" ? total : page.counts[f]);

  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label="Filter applicants" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            aria-pressed={filter === f.value}
            onClick={() => choose(f.value)}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-sm transition-colors",
              filter === f.value ? "border-primary bg-primary text-inverse" : "border-line bg-card text-body hover:border-line-strong",
            )}
          >
            {f.label} <span className={filter === f.value ? "text-primary-tint" : "text-secondary"}>{countOf(f.value)}</span>
          </button>
        ))}
      </div>

      {error ? <ErrorNotice error={error} onRetry={() => load(filter)} /> : null}

      {page.items.length === 0 && !loading ? (
        <EmptyState icon="users" title={filter === "all" ? "No applicants yet" : "No applicants here"}>
          {filter === "all" ? "When members apply, their profile and note appear here and we’ll notify you." : "Try another filter."}
        </EmptyState>
      ) : (
        <ul className={cn("flex flex-col gap-3", loading && "opacity-60")} aria-busy={loading}>
          {page.items.map((app) => (
            <li key={app.id}>
              <Panel className="flex flex-col gap-3 p-5">
                <div className="flex items-start gap-3">
                  <Link href={`/members/${app.applicant.handle}`} tabIndex={-1} aria-hidden="true">
                    <MemberAvatar member={app.applicant} />
                  </Link>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <AuthorName member={app.applicant} />
                    {app.applicant.headline && <p className="truncate text-sm text-secondary">{app.applicant.headline}</p>}
                    <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-secondary">
                      {app.location && (
                        <>
                          <Icon name="map-pin" size={12} />
                          {app.location}
                          <span aria-hidden="true">·</span>
                        </>
                      )}
                      Applied <TimeAgo iso={app.createdAt} />
                    </p>
                  </div>
                  <Chip tone={applicationTone[app.status]}>{APPLICATION_STATUS_LABELS[app.status]}</Chip>
                </div>
                <p className="whitespace-pre-line text-sm text-body">{app.note}</p>
                <div className="flex flex-wrap gap-2">
                  <Link href={`/members/${app.applicant.handle}`} className="text-sm font-medium text-primary-light hover:underline">
                    View profile
                  </Link>
                  <span className="flex-1" />
                  {app.status === "submitted" && (
                    <Button variant="secondary" size="small" onClick={() => decide(app, { status: "shortlisted" }).catch(toast.error)}>
                      Shortlist
                    </Button>
                  )}
                  {app.status !== "submitted" && (
                    <Button variant="secondary" size="small" onClick={() => decide(app, { status: "submitted" }).catch(toast.error)}>
                      Move back to new
                    </Button>
                  )}
                  {app.status !== "declined" && (
                    <Button variant="secondary" size="small" onClick={() => (setMessage(""), setDecision({ app, status: "declined" }))}>
                      Decline
                    </Button>
                  )}
                  {app.status !== "accepted" && (
                    <Button size="small" onClick={() => (setMessage(""), setDecision({ app, status: "accepted" }))}>
                      Accept
                    </Button>
                  )}
                </div>
              </Panel>
            </li>
          ))}
        </ul>
      )}

      {page.nextCursor && (
        <div className="flex justify-center">
          <Button variant="secondary" aria-disabled={loading} onClick={() => load(filter, page.nextCursor ?? undefined)}>
            {loading ? "Loading…" : "Show more"}
          </Button>
        </div>
      )}

      {decision && (
        <ConfirmDialog
          title={decision.status === "accepted" ? `Accept ${decision.app.applicant.name}?` : `Decline ${decision.app.applicant.name}?`}
          confirmLabel={decision.status === "accepted" ? "Accept and notify" : "Decline and notify"}
          danger={decision.status === "declined"}
          onClose={() => setDecision(null)}
          onConfirm={() => decide(decision.app, { status: decision.status, message: message.trim() || undefined })}
        >
          <div className="flex flex-col gap-2">
            <p>
              We’ll notify them about “{title}”.{" "}
              {decision.status === "accepted" ? "Add next steps or how to reach you." : "A short, kind note goes a long way."}
            </p>
            <label htmlFor="decision-message" className="text-sm font-medium text-ink">
              Message (optional)
            </label>
            <textarea
              id="decision-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={1000}
              rows={4}
              className="w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-light"
            />
          </div>
        </ConfirmDialog>
      )}
    </div>
  );
}
