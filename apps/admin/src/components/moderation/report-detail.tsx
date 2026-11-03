"use client";

import type { AdminActionView, AdminReportDetail, ModerationActionKind } from "@chartermission/contracts";
import { Avatar, Chip, Divider, Icon, buttonClasses, cn } from "@chartermission/ui";
import { Age, DateTime } from "@/components/time";
import {
  ACTION_LABELS,
  ACTION_TONES,
  APPEAL_STATUS_CHIP,
  POLICY_REF_LABELS,
  PRIORITY_CHIP,
  REPORT_REASON_LABELS,
  STATUS_CHIP,
  TARGET_LABELS,
} from "@/lib/labels";
import { webHref } from "@/lib/navigation";
import { formatCount } from "@/lib/format";
import { actionDef, availableActions, type ActionStyle } from "./moderation-actions";

const actionClasses: Record<ActionStyle, string> = {
  primary: buttonClasses({ variant: "primary", size: "small" }),
  secondary: buttonClasses({ variant: "secondary", size: "small" }),
  // Secondary button with error text (Figma "Suspend account").
  danger: buttonClasses({ variant: "secondary", size: "small", className: "text-error!" }),
  ghost: buttonClasses({ variant: "ghost", size: "small" }),
};

function SectionLabel({ children }: { children: string }) {
  return <h3 className="text-label text-secondary uppercase">{children}</h3>;
}

/** One moderation action in a history list. */
/** What an action was about, e.g. "On another post: “Send me $20…”" or "On the member’s account". */
function actionSubject(action: AdminActionView, current?: { type: string; id: string }): string | null {
  if (current && action.targetType === current.type && action.targetId === current.id) return null;
  const kind = TARGET_LABELS[action.targetType].toLowerCase();
  if (action.targetType === "member") return "On the member’s account";
  const where = current ? `On another ${kind}` : `On a ${kind}`;
  return action.targetPreview ? `${where}: “${action.targetPreview}”` : where;
}

/**
 * One moderation action. Pass `current` (the case being viewed) so actions on other content say
 * what they were about; actions on the same item stay unlabelled.
 */
export function ActionHistoryItem({ action, current }: { action: AdminActionView; current?: { type: string; id: string } }) {
  const subject = actionSubject(action, current);
  return (
    <li className="flex flex-col gap-1 rounded-[10px] border border-line p-3">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-secondary">
        <Chip tone={ACTION_TONES[action.action]} className="px-2! py-0.5! text-xs!">
          {ACTION_LABELS[action.action]}
        </Chip>
        <span>
          by <span className="text-body">{action.moderator.name}</span>
        </span>
        <span aria-hidden="true">·</span>
        <DateTime iso={action.createdAt} />
      </p>
      {subject && <p className="line-clamp-2 text-xs break-words text-body">{subject}</p>}
      <p className="text-sm text-ink">“{action.reason}”</p>
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-secondary">
        {action.policyRef && <span>Policy: {POLICY_REF_LABELS[action.policyRef]}</span>}
        {action.expiresAt && (
          <span>
            Until <DateTime iso={action.expiresAt} />
          </span>
        )}
        {action.revokedAt && (
          <span className="text-success">
            Lifted <DateTime iso={action.revokedAt} />
          </span>
        )}
        {action.appealStatus && <span>{APPEAL_STATUS_CHIP[action.appealStatus].label}</span>}
      </p>
    </li>
  );
}

/** Case detail and actions (Figma "Report detail", node 12:1731). */
export function ReportDetail({
  id,
  detail,
  viewerId,
  canAct,
  busy,
  assigning,
  onAction,
  onAssign,
}: {
  id: string;
  detail: AdminReportDetail;
  viewerId: string;
  canAct: boolean;
  busy: boolean;
  assigning: boolean;
  onAction: (kind: ModerationActionKind) => void;
  onAssign: (assignee: "me" | "none") => void;
}) {
  const priority = PRIORITY_CHIP[detail.priority];
  const status = STATUS_CHIP[detail.status];
  const open = detail.status === "open" || detail.status === "in_review";
  const kinds = availableActions(detail);
  const defs = kinds.map((kind) => actionDef(kind, detail.target.type));
  const mainActions = defs.filter((d) => d.style !== "ghost");
  const quietActions = defs.filter((d) => d.style === "ghost");
  const assignedToMe = detail.assignedTo?.id === viewerId;
  const history = detail.authorHistory;
  const state = detail.content.moderationState;

  return (
    <section
      id={id}
      aria-label={`${TARGET_LABELS[detail.target.type]} report detail`}
      aria-busy={busy}
      className={cn(
        "flex min-w-0 flex-col gap-4 rounded-card border border-line bg-card p-4 transition-opacity sm:p-5",
        busy && "opacity-60",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-h3 text-ink">
            {TARGET_LABELS[detail.target.type]} report
            <span className="font-normal text-secondary">
              {" "}
              · {formatCount(detail.reportCount)} {detail.reportCount === 1 ? "report" : "reports"}
            </span>
          </h2>
          <p className="text-xs text-secondary">
            First reported <DateTime iso={detail.createdAt} />
          </p>
        </div>
        <div className="flex gap-1.5">
          <Chip tone={priority.tone}>{priority.label}</Chip>
          <Chip tone={status.tone}>{status.label}</Chip>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
        <span className="flex min-w-0 items-center gap-2 text-body">
          <Icon name="user" size={16} className="shrink-0 text-secondary" />
          {detail.assignedTo ? (
            <span className="truncate">
              Assigned to <span className="font-medium text-ink">{assignedToMe ? "you" : detail.assignedTo.name}</span>
            </span>
          ) : (
            <span>Unassigned</span>
          )}
        </span>
        {canAct && open && (
          <button
            type="button"
            disabled={assigning}
            aria-busy={assigning}
            onClick={() => onAssign(assignedToMe ? "none" : "me")}
            className="rounded-md px-2 py-1 text-sm font-medium text-primary hover:bg-primary-tint-2 disabled:opacity-60"
          >
            {assigning ? "Saving…" : assignedToMe ? "Unassign" : detail.assignedTo ? "Take over" : "Assign to me"}
          </button>
        )}
      </div>

      <figure className="flex flex-col gap-2 rounded-[10px] border border-line bg-surface p-3.5">
        <figcaption className="flex flex-wrap items-center gap-2 text-xs text-secondary">
          {detail.author ? (
            <>
              <Avatar name={detail.author.name} size={24} tone={detail.author.tone} src={detail.author.avatarUrl ?? undefined} />
              <span className="font-medium text-ink">{detail.author.name}</span>
              <span>@{detail.author.handle}</span>
              {detail.author.staff && <Chip tone="info" className="px-2! py-0! text-xs!">Staff</Chip>}
            </>
          ) : (
            <span>{detail.target.type === "hashtag" ? "Topic" : "Unknown author"}</span>
          )}
          {detail.content.createdAt && (
            <>
              <span aria-hidden="true">·</span>
              <Age iso={detail.content.createdAt} />
            </>
          )}
          {state && state !== "visible" && (
            <Chip tone={state === "hidden" ? "info" : "error"} className="px-2! py-0! text-xs!">
              {state === "hidden" ? "Hidden" : state === "removed" ? "Removed" : "Deleted by author"}
            </Chip>
          )}
        </figcaption>
        <blockquote className="max-h-60 overflow-y-auto text-sm break-words whitespace-pre-wrap text-ink">
          {detail.content.body ?? detail.target.preview}
        </blockquote>
        {(detail.content.attachmentCount > 0 || detail.content.href) && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-secondary">
            <span>
              {detail.content.attachmentCount > 0 &&
                `${detail.content.attachmentCount} attachment${detail.content.attachmentCount === 1 ? "" : "s"}`}
            </span>
            {detail.content.href && (
              <a
                href={webHref(detail.content.href)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-sm font-medium text-primary hover:underline"
              >
                View on site
                <Icon name="external" size={14} />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            )}
          </div>
        )}
      </figure>

      <div className="flex flex-col gap-1.5">
        <SectionLabel>Reporter reasons</SectionLabel>
        <ul className="flex flex-col gap-1.5 text-sm text-body">
          {detail.reasons.map((r, i) => (
            <li key={`${r.reason}-${i}`} className="flex flex-col">
              <span>
                <span className="font-medium text-ink">{REPORT_REASON_LABELS[r.reason]}</span> · {r.count}{" "}
                {r.count === 1 ? "report" : "reports"}
              </span>
              {r.detail && <span className="text-secondary">“{r.detail}”</span>}
            </li>
          ))}
        </ul>
      </div>

      {history && (
        <div className="flex flex-col gap-1.5">
          <SectionLabel>Author history</SectionLabel>
          <ul className="flex flex-col gap-1.5 text-sm text-body">
            <li className="flex items-center gap-2">
              <Icon
                name="flag"
                size={16}
                className={cn("shrink-0", history.previousActioned > 0 ? "text-error" : "text-secondary")}
              />
              {history.previousReports === 0
                ? "No previous reports"
                : `${history.previousReports} previous ${history.previousReports === 1 ? "report" : "reports"} · ${history.previousActioned} actioned`}
            </li>
            <li className="flex items-center gap-2">
              <Icon name="eye-off" size={16} className={cn("shrink-0", history.hiddenItems > 0 ? "text-error" : "text-secondary")} />
              {history.hiddenItems === 0
                ? "No hidden content"
                : `${history.hiddenItems} ${history.hiddenItems === 1 ? "item" : "items"} hidden or removed`}
            </li>
            <li className="flex items-center gap-2">
              <Icon name="mail" size={16} className="shrink-0 text-secondary" />
              <span>
                {history.emailVerified ? "Email verified" : "Email not verified"} ·{" "}
                {history.hasAvatar ? "has a profile photo" : "no profile photo"} · joined{" "}
                <DateTime iso={history.joinedAt} dateOnly />
              </span>
            </li>
            <li className="flex items-center gap-2">
              <Icon
                name="user"
                size={16}
                className={cn("shrink-0", history.status === "active" ? "text-secondary" : "text-error")}
              />
              Account {history.status.replace(/_/g, " ")}
            </li>
            {history.recentActions.length > 0 && (
              <li className="flex flex-wrap items-center gap-1.5 pl-6 text-xs text-secondary">
                Recent:
                {history.recentActions.map((a, i) => (
                  <span key={i}>
                    {ACTION_LABELS[a.action]} (<DateTime iso={a.createdAt} dateOnly />){i < history.recentActions.length - 1 ? "," : ""}
                  </span>
                ))}
              </li>
            )}
          </ul>
        </div>
      )}

      {detail.previousActions.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <SectionLabel>Previous actions</SectionLabel>
          <ul className="flex flex-col gap-2">
            {detail.previousActions.map((action) => (
              <ActionHistoryItem key={action.id} action={action} current={detail.target} />
            ))}
          </ul>
        </div>
      )}

      <Divider />

      <div className="flex flex-col gap-2.5">
        <SectionLabel>Action</SectionLabel>
        {!canAct ? (
          <p className="text-sm text-secondary">Your role can review reports but not act on them.</p>
        ) : defs.length === 0 ? (
          <p className="text-sm text-secondary">There’s nothing left to do on this report.</p>
        ) : (
          <>
            {!open && (
              <p className="text-xs text-secondary">
                This report is resolved. Actions you take now apply directly to the {TARGET_LABELS[detail.target.type].toLowerCase()} and
                are recorded without reopening the report.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {mainActions.map((def) => (
                <button
                  key={def.kind}
                  type="button"
                  disabled={busy}
                  className={actionClasses[def.style]}
                  onClick={() => onAction(def.kind)}
                >
                  {def.label}
                </button>
              ))}
            </div>
            {quietActions.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {quietActions.map((def) => (
                  <button
                    key={def.kind}
                    type="button"
                    disabled={busy}
                    className={actionClasses[def.style]}
                    onClick={() => onAction(def.kind)}
                  >
                    {def.label}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <p className="flex items-center gap-2 rounded-lg bg-info-light p-3 text-xs text-body">
        <Icon name="alert" size={16} className="shrink-0 text-info" />
        Hidden content leaves feeds, topic pages, trending and search within 60 seconds. The author can appeal once, to a
        different moderator.
      </p>
    </section>
  );
}
