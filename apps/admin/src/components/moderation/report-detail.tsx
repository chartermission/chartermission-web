import { Chip, Divider, Icon, buttonClasses, cn } from "@chartermission/ui";
import { priorityChip, type QueueItem, type QueueTab } from "@/lib/mock/moderation";
import { queueNotes, reasonsHeading, type ActionStyle, type ModerationAction } from "./moderation-actions";

export type Resolution = {
  action: ModerationAction;
  reason: string;
  duration?: string;
  /** Local time the action was confirmed, HH:MM. */
  at: string;
};

const actionClasses: Record<ActionStyle, string> = {
  primary: buttonClasses({ variant: "primary", size: "small" }),
  secondary: buttonClasses({ variant: "secondary", size: "small" }),
  // Secondary button with error text (Figma "Suspend account").
  danger: buttonClasses({ variant: "secondary", size: "small", className: "text-error!" }),
  ghost: buttonClasses({ variant: "ghost", size: "small" }),
};

function handleInitials(handle: string) {
  return handle
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function SectionLabel({ children }: { children: string }) {
  return <h3 className="text-label text-secondary uppercase">{children}</h3>;
}

/** Case detail and actions (Figma "Report detail", node 12:1731). */
export function ReportDetail({
  id,
  item,
  tab,
  caseLabel,
  actions,
  resolution,
  onAction,
}: {
  id: string;
  item: QueueItem;
  tab: QueueTab;
  caseLabel: string;
  actions: ModerationAction[];
  resolution?: Resolution;
  onAction: (action: ModerationAction) => void;
}) {
  const priority = priorityChip[item.priority];
  const mainActions = actions.filter((action) => action.style !== "ghost");
  const quietActions = actions.filter((action) => action.style === "ghost");

  return (
    <section
      id={id}
      aria-label={`${caseLabel} ${item.id} detail`}
      className="flex flex-col gap-4 rounded-card border border-line bg-card p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-h3 text-ink">
          {caseLabel} #{item.id}
        </h2>
        <Chip tone={priority.tone}>{priority.label}</Chip>
      </div>

      <figure className="flex flex-col gap-2 rounded-[10px] border border-line bg-surface p-3.5">
        <figcaption className="flex items-center gap-2 text-xs text-secondary">
          <span
            aria-hidden="true"
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-error-light text-xs text-error"
          >
            {handleInitials(item.author.handle)}
          </span>
          {item.author.handle} · {item.author.meta}
        </figcaption>
        <blockquote className="text-sm text-ink">{item.excerpt}</blockquote>
      </figure>

      <div className="flex flex-col gap-1.5">
        <SectionLabel>{reasonsHeading[tab]}</SectionLabel>
        <ul className="flex flex-col gap-1.5 text-sm text-body">
          {item.reporterReasons.map((reason) => (
            <li key={reason.quote}>
              “{reason.quote}” · {reason.count} {reason.count === 1 ? "report" : "reports"}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-1.5">
        <SectionLabel>Author history</SectionLabel>
        <ul className="flex flex-col gap-1.5 text-sm text-body">
          {item.history.map((entry) => (
            <li key={entry.text} className="flex items-center gap-2">
              <Icon name={entry.icon} size={16} className={cn("shrink-0", entry.flagged ? "text-error" : "text-secondary")} />
              {entry.text}
            </li>
          ))}
        </ul>
      </div>

      <Divider />

      <div className="flex flex-col gap-2.5">
        <SectionLabel>Action</SectionLabel>
        {resolution ? (
          <div className="flex flex-col gap-2 rounded-[10px] border border-line bg-surface p-3.5">
            <p className="flex flex-wrap items-center gap-2 text-sm text-body">
              <Chip tone={resolution.action.outcomeTone}>{resolution.action.outcome}</Chip>
              {resolution.duration && <span>for {resolution.duration}</span>}
              <span className="text-secondary">by you · {resolution.at}</span>
            </p>
            <p className="text-sm text-ink">
              <span className="text-secondary">Reason: </span>“{resolution.reason}”
            </p>
            <p className="flex items-center gap-1.5 text-xs text-success">
              <Icon name="check" size={14} />
              Written to the audit log
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {mainActions.map((action) => (
                <button key={action.id} type="button" className={actionClasses[action.style]} onClick={() => onAction(action)}>
                  {action.label}
                </button>
              ))}
            </div>
            {quietActions.length > 0 && (
              <div className="flex">
                {quietActions.map((action) => (
                  <button key={action.id} type="button" className={actionClasses[action.style]} onClick={() => onAction(action)}>
                    {action.label}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <p className="flex items-center gap-2 rounded-lg bg-info-light p-3 text-xs text-body">
        <Icon name="alert" size={16} className="shrink-0 text-info" />
        {queueNotes[tab]}
      </p>
    </section>
  );
}
