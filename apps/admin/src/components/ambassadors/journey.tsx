"use client";

import { LEAD_STAGE_LABELS, type AdminLeadDetail, type LeadJourneyStage, type LeadStage } from "@chartermission/contracts";
import { Button, Icon, cn } from "@chartermission/ui";
import { Age, DateTime } from "@/components/time";

export type JourneyAction =
  | { kind: "complete"; to: LeadStage }
  | { kind: "waive"; to: LeadStage }
  | { kind: "back"; to: LeadStage }
  | { kind: "jump"; to: LeadStage }
  | { kind: "close" }
  | { kind: "reopen" };

const STATE_LABEL: Record<LeadJourneyStage["state"], string> = { done: "Completed", waived: "Waived", current: "In progress", upcoming: "Not started" };

/**
 * The lead's journey: the seven stages in order, what happened in each, and the actions for
 * where they are now. Completed and waived stages can be reopened ("Go back"); a stage that
 * doesn't apply to this lead can be waived with a note; later stages can be jumped to, which
 * records the ones in between as waived.
 */
export function Journey({ lead, busy, onAction }: { lead: AdminLeadDetail; busy: boolean; onAction: (action: JourneyAction) => void }) {
  const stages = lead.journey;
  const at = stages.findIndex((s) => s.state === "current");
  const current = at >= 0 ? stages[at]! : null;
  const next = at >= 0 && at < stages.length - 1 ? stages[at + 1]! : null;
  const certified = lead.stage === "ambassador" || lead.stage === "alumni";
  const closedEarly = !current && !certified;
  const reached = stages.filter((s) => s.state === "done" || s.state === "waived").length;

  return (
    <section aria-labelledby="journey-heading" className="rounded-card border border-line bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
        <h2 id="journey-heading" className="text-md font-semibold text-ink">
          Journey
        </h2>
        <p className="text-xs text-secondary">
          {certified
            ? "All stages finished"
            : current
              ? `Stage ${at + 1} of ${stages.length}`
              : `Stopped after ${reached} of ${stages.length} stages`}
        </p>
      </div>

      <ol className="grid gap-x-1 gap-y-0 px-5 pt-5 pb-1 max-lg:grid-cols-1 lg:grid-cols-7">
        {stages.map((s, i) => {
          const past = s.state === "done" || s.state === "waived";
          const canGoBack = past && !certified && !busy;
          const canJump = s.state === "upcoming" && !!current && i > at + 1 && !busy;
          const clickable = canGoBack || canJump;
          const Body = (
            <>
              <span className="flex items-center gap-2 lg:w-full">
                <span
                  className={cn(
                    "inline-flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                    s.state === "done" && "bg-success text-inverse",
                    s.state === "waived" && "border border-dashed border-line-strong bg-muted text-secondary",
                    s.state === "current" && "bg-primary text-inverse ring-4 ring-primary-tint",
                    s.state === "upcoming" && "border border-line-strong bg-card text-secondary",
                  )}
                >
                  {s.state === "done" ? <Icon name="check" size={14} /> : s.state === "waived" ? <Icon name="x" size={14} /> : i + 1}
                </span>
                {i < stages.length - 1 && (
                  <span aria-hidden className={cn("h-0.5 flex-1 rounded max-lg:hidden", past ? "bg-success" : "bg-line")} />
                )}
              </span>
              <span className="flex min-w-0 flex-col lg:mt-2 lg:pr-2">
                <span className={cn("text-sm font-medium", s.state === "upcoming" ? "text-secondary" : "text-ink", s.state === "waived" && "line-through decoration-line-strong")}>
                  {s.label}
                </span>
                <span className={cn("text-xs", s.state === "current" ? "font-medium text-primary" : "text-secondary")}>
                  {STATE_LABEL[s.state]}
                  {s.state === "current" && (
                    <>
                      {" · "}
                      <Age iso={lead.stageChangedAt} />
                    </>
                  )}
                  {past && s.at && (
                    <>
                      {" "}
                      <DateTime iso={s.at} dateOnly />
                    </>
                  )}
                </span>
                {past && (s.by || s.note) && (
                  <span className="truncate text-xs text-secondary" title={[s.by?.name, s.note].filter(Boolean).join(": ")}>
                    {[s.by ? `by ${s.by.name}` : null, s.note].filter(Boolean).join(" · ")}
                  </span>
                )}
                {clickable && <span className="mt-0.5 text-xs font-medium text-primary group-hover:underline">{canGoBack ? "Go back to this stage" : "Skip ahead to here"}</span>}
              </span>
            </>
          );
          return (
            <li key={s.stage} aria-current={s.state === "current" ? "step" : undefined} className="min-w-0">
              {clickable ? (
                <button
                  type="button"
                  onClick={() => onAction({ kind: canGoBack ? "back" : "jump", to: s.stage })}
                  className="group flex w-full gap-3 rounded-lg pb-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary-light lg:flex-col lg:gap-0"
                >
                  {Body}
                </button>
              ) : (
                <div className="flex gap-3 pb-4 lg:flex-col lg:gap-0">{Body}</div>
              )}
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface px-5 py-4">
        {current ? (
          <>
            <div className="min-w-0 flex-1 basis-72">
              <p className="text-sm font-medium text-ink">Now: {current.label}</p>
              <p className="text-xs text-secondary">{current.hint}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {next && (
                <>
                  <Button size="small" disabled={busy} onClick={() => onAction({ kind: "complete", to: next.stage })}>
                    <Icon name="check" size={16} />
                    Complete and move to {next.label}
                  </Button>
                  <Button size="small" variant="secondary" disabled={busy} onClick={() => onAction({ kind: "waive", to: next.stage })}>
                    Waive this stage
                  </Button>
                </>
              )}
              {at > 0 && (
                <Button size="small" variant="ghost" disabled={busy} onClick={() => onAction({ kind: "back", to: stages[at - 1]!.stage })}>
                  Go back a stage
                </Button>
              )}
              <Button size="small" variant="ghost" disabled={busy} onClick={() => onAction({ kind: "close" })}>
                Close lead
              </Button>
            </div>
          </>
        ) : certified ? (
          <p className="text-sm text-body">
            {lead.stage === "ambassador" ? "Certified: every stage is finished and the badge is live." : "Their term has ended. The journey is kept for the record."}
          </p>
        ) : closedEarly ? (
          <>
            <div className="min-w-0 flex-1 basis-72">
              <p className="text-sm font-medium text-ink">Closed: {LEAD_STAGE_LABELS[lead.stage]}</p>
              <p className="text-xs text-secondary">The stages they finished are kept. Reopen the lead to carry on from any stage.</p>
            </div>
            <Button size="small" variant="secondary" disabled={busy} onClick={() => onAction({ kind: "reopen" })}>
              Reopen lead
            </Button>
          </>
        ) : null}
      </div>
    </section>
  );
}
