"use client";

import { useId } from "react";
import type { DraftView, PostType } from "@chartermission/contracts";
import { Button, Icon, cn, type IconName } from "@chartermission/ui";
import { LocalDateTime, TimeAgo } from "./local-time";

const typeMeta: Record<PostType, { label: string; icon: IconName }> = {
  standard: { label: "Post", icon: "message" },
  question: { label: "Question", icon: "lightbulb" },
  celebration: { label: "Celebration", icon: "flame" },
  request: { label: "Looking for", icon: "search" },
  article: { label: "Article", icon: "book" },
};

function kindOf(draft: DraftView): { label: string; icon: IconName } {
  if (draft.payload.kind === "announcement") return { label: "Announcement", icon: "flag" };
  if (draft.payload.type === "standard" && draft.payload.poll) return { label: "Poll", icon: "chart" };
  return typeMeta[draft.payload.type];
}

/** Second line under the preview: the body when the preview is a title, otherwise nothing. */
function secondary(draft: DraftView) {
  const body = draft.payload.body.trim();
  if (!body || body.startsWith(draft.preview)) return draft.payload.article?.subtitle?.trim() || null;
  return draft.payload.article?.subtitle?.trim() || body;
}

const sentence = (text: string) => (/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

export type DraftAction = "edit" | "publish" | "unschedule" | "delete";

/** One draft or scheduled post on /drafts: what it is, when it was edited or will publish, and its actions. */
export function DraftCard({ draft, busy, onAction }: { draft: DraftView; busy: DraftAction | null; onAction: (action: DraftAction) => void }) {
  const id = useId();
  const kind = kindOf(draft);
  const more = secondary(draft);
  const failed = draft.status === "failed";
  const scheduled = draft.status === "scheduled";
  const untitled = draft.preview === "Untitled draft";
  const disabled = busy !== null;

  return (
    <article
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-meta`}
      aria-busy={disabled}
      className={cn("flex w-full flex-col gap-3.5 rounded-card border bg-card p-5 max-sm:px-4", failed ? "border-error/40" : "border-line")}
    >
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <span className="flex items-center gap-2 text-sm font-medium text-body">
          <span className="flex size-7 items-center justify-center rounded-full bg-primary-tint-2 text-primary-light">
            <Icon name={kind.icon} size={16} />
          </span>
          {kind.label}
          {draft.payload.visibility === "public" && (
            <span className="flex items-center gap-1 text-xs font-normal text-secondary">
              <span aria-hidden="true">·</span>
              <Icon name="globe" size={13} />
              Public
            </span>
          )}
        </span>
        <span id={`${id}-meta`}>
          {failed && draft.scheduledFor ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-error-light px-2.5 py-1 text-xs font-medium text-error">
              <Icon name="alert" size={14} />
              <span className="sr-only">Couldn’t publish. Was scheduled for </span>
              <span aria-hidden="true">Not published ·</span> <LocalDateTime iso={draft.scheduledFor} />
            </span>
          ) : scheduled && draft.scheduledFor ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-info-light px-2.5 py-1 text-xs font-medium text-info">
              <Icon name="clock" size={14} />
              <span className="text-ink">
                <span className="text-secondary">Publishes </span>
                <LocalDateTime iso={draft.scheduledFor} />
              </span>
            </span>
          ) : (
            <TimeAgo iso={draft.updatedAt} prefix="Edited" className="text-xs text-secondary" />
          )}
        </span>
      </header>

      <div className="flex flex-col gap-1">
        <p id={`${id}-title`} className={cn("line-clamp-2 break-words text-md", untitled ? "italic text-secondary" : "font-medium text-ink")}>
          {draft.preview}
        </p>
        {more && <p className="line-clamp-2 whitespace-pre-line break-words text-sm text-body">{more}</p>}
      </div>

      {draft.attachments.length > 0 && (
        <ul aria-label="Attachments" className="flex flex-wrap gap-2">
          {draft.attachments.map((file) =>
            file.kind === "image" ? (
              <li key={file.id} className="size-16 overflow-hidden rounded-lg border border-line bg-muted">
                {file.url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- API media URL, already sized for thumbnails
                  <img src={file.url} alt={draft.payload.altTexts?.[file.id] || file.name || "Attached image"} className="size-full object-cover" />
                ) : (
                  <span className="flex size-full items-center justify-center text-secondary" title="This image is still being checked">
                    <Icon name="image" size={20} />
                    <span className="sr-only">Image ({file.name ?? "attachment"}) still being checked</span>
                  </span>
                )}
              </li>
            ) : (
              <li key={file.id} className="flex h-16 max-w-[220px] items-center gap-2 rounded-lg border border-line bg-muted px-3">
                <Icon name={file.kind === "video" ? "video" : "book"} size={18} className={cn("shrink-0", file.kind === "video" ? "text-warning" : "text-error")} />
                <span className="truncate text-sm text-ink">{file.name ?? "Document"}</span>
              </li>
            ),
          )}
        </ul>
      )}

      {failed && (
        <div role="note" className="flex items-start gap-2.5 rounded-lg bg-error-light px-3 py-2.5 text-sm text-ink">
          <Icon name="alert" size={18} className="mt-0.5 shrink-0 text-error" />
          <p>
            <span className="font-medium">This post couldn’t be published.</span> {sentence(draft.lastError ?? "Something went wrong at the scheduled time")} Fix it and pick a new time,
            or publish it now.
          </p>
        </div>
      )}

      <footer className="flex flex-wrap items-center gap-2 border-t border-line pt-3.5">
        {failed ? (
          <Button size="small" aria-describedby={`${id}-title`} onClick={() => onAction("edit")} disabled={disabled}>
            Fix and reschedule
          </Button>
        ) : (
          <Button size="small" variant="secondary" aria-describedby={`${id}-title`} onClick={() => onAction("edit")} disabled={disabled}>
            Edit
          </Button>
        )}
        <Button size="small" variant={failed ? "secondary" : "primary"} aria-describedby={`${id}-title`} onClick={() => onAction("publish")} disabled={disabled}>
          {busy === "publish" ? "Publishing…" : "Publish now"}
        </Button>
        <span className="ms-auto flex items-center gap-1">
          {scheduled && (
            <Button size="small" variant="ghost" aria-describedby={`${id}-title`} onClick={() => onAction("unschedule")} disabled={disabled}>
              {busy === "unschedule" ? "Moving…" : "Unschedule"}
            </Button>
          )}
          <button
            type="button"
            aria-describedby={`${id}-title`}
            onClick={() => onAction("delete")}
            disabled={disabled}
            className="inline-flex items-center rounded-lg px-3 py-1.5 text-sm font-medium text-error transition-colors hover:bg-error-light disabled:pointer-events-none disabled:opacity-50"
          >
            Delete
          </button>
        </span>
      </footer>
    </article>
  );
}
