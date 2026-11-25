"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import type { ContentCalendarAction, ContentCalendarActionResult, ContentCalendarDetail, ContentCalendarKind, McpAction } from "@chartermission/contracts";
import { Avatar, Button, Chip, Icon, cn, VerifiedBadge } from "@chartermission/ui";
import { DateTime } from "@/components/time";
import { api, errorMessage } from "@/lib/api/client";
import { MCP_ACTION_LABELS } from "@/lib/labels";
import { WEB_URL } from "@/lib/navigation";
import { useIntlTag, useT } from "@/i18n/client";
import { ActionDialog } from "./action-dialog";
import { ACTION_LABELS, DANGER, stateMeta, utcTitle } from "./shared";

const HISTORY_LABELS: Record<string, string> = {
  "content_calendar.held": "Put on hold",
  "content_calendar.released": "Released",
  "content_calendar.rescheduled": "Moved to a new time",
  "content_calendar.cancelled": "Cancelled",
  "content_calendar.approved": "Approved",
  "content_calendar.declined": "Declined",
  "content_calendar.published": "Published at its scheduled time",
  "moderation.hide": "Hidden",
  "moderation.remove": "Removed",
  "moderation.restore": "Restored",
};

/** Side panel with the full post, its author, what Claude did and the review history, plus the actions its state allows. */
export function ItemDrawer({
  item,
  canAct,
  onClose,
  onChanged,
  onOnlyAuthor,
}: {
  item: { kind: ContentCalendarKind; id: string };
  canAct: boolean;
  onClose: () => void;
  /** After an action: the list should reload. */
  onChanged: () => void;
  onOnlyAuthor: (authorId: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const t = useT();
  const tag = useIntlTag();
  const [detail, setDetail] = useState<ContentCalendarDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<ContentCalendarAction | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    // The drawer is keyed by item, so it starts empty for each one.
    const controller = new AbortController();
    api<ContentCalendarDetail>(`/admin/content-calendar/${item.kind}/${item.id}`, { signal: controller.signal })
      .then(setDetail)
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      });
    return () => controller.abort();
  }, [item.kind, item.id]);

  function done(result: ContentCalendarActionResult) {
    setPending(null);
    onChanged();
    if (result.item) setDetail(result.item);
    else ref.current?.close();
  }

  const meta = detail ? stateMeta(detail.state) : null;
  const when = detail?.scheduledFor ?? detail?.publishedAt ?? detail?.at ?? null;

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-title`}
      onClose={onClose}
      className="ms-auto me-0 my-0 h-dvh max-h-dvh w-[520px] max-w-full rounded-none border-s border-line bg-card p-0 text-ink shadow-[0_12px_40px_rgba(25,37,80,0.18)] backdrop:bg-primary-dark/30"
    >
      <div className="flex h-full flex-col">
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h2 id={`${id}-title`} className="text-h3 text-ink">
              {item.kind === "draft" ? "Scheduled post" : "Post"}
            </h2>
            {detail && meta && (
              <div className="flex flex-wrap items-center gap-2 text-sm text-secondary">
                <Chip tone={meta.tone}>{meta.label}</Chip>
                {detail.moderationState && detail.moderationState !== "visible" && <Chip tone="error">{detail.moderationState === "hidden" ? "Hidden" : "Removed"}</Chip>}
                {when && (
                  <span title={utcTitle(when, tag)}>
                    <DateTime iso={when} />
                  </span>
                )}
              </div>
            )}
          </div>
          <button type="button" onClick={() => ref.current?.close()} className="-m-1 rounded-md p-1 text-secondary hover:bg-muted hover:text-ink">
            <Icon name="x" size={18} label="Close" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error ? (
            <p role="alert" className="text-sm text-error">
              {error}
            </p>
          ) : !detail ? (
            <p role="status" className="text-sm text-secondary">
              Loading…
            </p>
          ) : (
            <div className="flex flex-col gap-5">
              <AuthorCard detail={detail} onOnlyAuthor={() => onOnlyAuthor(detail.author.id)} />

              {detail.review && (
                <div className={cn("rounded-lg px-3 py-2.5 text-sm", detail.review.state === "declined" ? "bg-error-light" : detail.review.state === "approved" ? "bg-success-light" : "bg-accent-light")}>
                  <p className="font-medium text-ink">
                    {detail.review.state === "pending"
                      ? "Waiting for approval"
                      : detail.review.by
                        ? t(detail.review.state === "approved" ? "Approved by {name}" : "Declined by {name}", { name: detail.review.by.name })
                        : detail.review.state === "approved"
                          ? "Approved"
                          : "Declined"}
                  </p>
                  {detail.review.note && <p className="mt-1 text-body">“{detail.review.note}”</p>}
                </div>
              )}
              {detail.lastError && (
                <p className="rounded-lg bg-error-light px-3 py-2.5 text-sm text-ink">
                  <span className="font-medium">It couldn’t be published:</span> {detail.lastError}
                </p>
              )}

              <PostContent detail={detail} />

              <section aria-labelledby={`${id}-claude`} className="flex flex-col gap-2">
                <h3 id={`${id}-claude`} className="text-label text-secondary uppercase">
                  Claude activity
                </h3>
                {detail.claudeActivity.length === 0 ? (
                  <p className="text-sm text-secondary">{detail.source === "claude" ? "No Claude actions are logged for it." : "Written on the site or app, not with Claude."}</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {detail.claudeActivity.map((a) => (
                      <li key={a.id} className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-ink">
                          {MCP_ACTION_LABELS[a.action as McpAction] ?? a.action} <span className="text-secondary">· {a.clientName}</span>
                        </span>
                        <DateTime iso={a.at} className="shrink-0 text-xs text-secondary tabular-nums" />
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section aria-labelledby={`${id}-history`} className="flex flex-col gap-2">
                <h3 id={`${id}-history`} className="text-label text-secondary uppercase">
                  Review history
                </h3>
                {detail.history.length === 0 ? (
                  <p className="text-sm text-secondary">Nobody on the team has acted on it yet.</p>
                ) : (
                  <ol className="flex flex-col gap-2.5">
                    {detail.history.map((h) => (
                      <li key={h.id} className="flex flex-col gap-0.5 border-s-2 border-line ps-3 text-sm">
                        <span className="text-ink">
                          {HISTORY_LABELS[h.action] ?? h.action}
                          {h.actor && <span className="text-secondary"> · {h.actor.name}</span>}
                        </span>
                        {h.scheduledFor && (
                          <span className="text-secondary">
                            <DateTime iso={h.scheduledFor} />
                          </span>
                        )}
                        {h.note && <span className="text-body">“{h.note}”</span>}
                        <DateTime iso={h.at} className="text-xs text-secondary" />
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </div>
          )}
        </div>

        {detail && (canAct || detail.postUrl) && (
          <footer className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
            {canAct &&
              detail.actions.map((action) => (
                <Button key={action} size="small" variant={DANGER.has(action) ? "secondary" : action === "approve" || action === "release" ? "primary" : "secondary"} onClick={() => setPending(action)} className={DANGER.has(action) ? "text-error" : undefined}>
                  {ACTION_LABELS[action]}
                </Button>
              ))}
            {detail.postUrl && (
              <a href={detail.postUrl} target="_blank" rel="noreferrer" className="ms-auto inline-flex items-center gap-1 text-sm font-medium text-primary-light hover:underline">
                View on site
                <Icon name="arrow-up-right" size={14} />
              </a>
            )}
          </footer>
        )}
      </div>
      {pending && detail && (
        <ActionDialog kind={detail.kind} id={detail.id} action={pending} scheduledFor={detail.scheduledFor} onDone={done} onClose={() => setPending(null)} />
      )}
    </dialog>
  );
}

function AuthorCard({ detail, onOnlyAuthor }: { detail: ContentCalendarDetail; onOnlyAuthor: () => void }) {
  const a = detail.author;
  return (
    <div className="flex items-start gap-3 rounded-lg border border-line p-3">
      <Avatar name={a.name} size={40} src={a.avatarUrl ?? undefined} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-1 font-medium text-ink">
          {a.name}
          {a.verified && <VerifiedBadge size={16} label="Verified" />}
        </span>
        <span className="text-xs text-secondary">
          @{a.handle}
          {detail.page && ` · ${detail.page.name}`}
          {detail.chapter && ` · ${detail.chapter.name}`}
        </span>
        <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm">
          <a href={`${WEB_URL}/${a.handle}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-primary-light hover:underline">
            Profile
            <Icon name="arrow-up-right" size={13} />
          </a>
          <Link href="/members" className="font-medium text-primary-light hover:underline">
            Open Members
          </Link>
          <button type="button" onClick={onOnlyAuthor} className="font-medium text-primary-light hover:underline">
            Only this author’s posts
          </button>
        </span>
      </div>
    </div>
  );
}

/** The post as written: text, images, poll and type details. */
function PostContent({ detail }: { detail: ContentCalendarDetail }) {
  const t = useT();
  const images = detail.attachments.filter((a) => a.kind === "image");
  const others = detail.attachments.filter((a) => a.kind !== "image");
  return (
    <section aria-label="Post" className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5 text-xs">
        <Chip tone="neutral">{detail.visibility === "public" ? "Public" : "Members only"}</Chip>
        {detail.type !== "standard" && <Chip tone="neutral">{TYPE_LABELS[detail.type]}</Chip>}
        {detail.claudeClient && <Chip tone="info">{detail.claudeClient}</Chip>}
      </div>
      {detail.article && (
        <div>
          <p className="text-h3 text-ink">{detail.article.title || "Untitled article"}</p>
          {detail.article.subtitle && <p className="text-sm text-secondary">{detail.article.subtitle}</p>}
        </div>
      )}
      {detail.celebration && (
        <p className="text-sm text-ink">
          <span className="font-medium">{detail.celebration.headline || "Celebration"}</span>
          {detail.celebration.organisation && <span className="text-secondary"> · {detail.celebration.organisation}</span>}
        </p>
      )}
      {detail.request && (
        <div className="text-sm text-ink">
          <p className="font-medium">{detail.request.title || "Looking for"}</p>
          <p className="text-secondary">
            {[detail.request.location, detail.request.remote ? t("Remote") : null, ...detail.request.skills].filter(Boolean).join(" · ")}
          </p>
        </div>
      )}
      {detail.body ? <p dir="auto" className="whitespace-pre-wrap break-words text-sm text-ink">{detail.body}</p> : <p className="text-sm text-secondary italic">No text</p>}
      {images.length > 0 && (
        <ul aria-label="Images" className="grid grid-cols-2 gap-2">
          {images.map((img) => (
            <li key={img.id} className="aspect-square overflow-hidden rounded-lg border border-line bg-muted">
              {img.url ? (
                // eslint-disable-next-line @next/next/no-img-element -- API media URL
                <img src={img.url} alt={img.alt || img.name || "Attached image"} className="size-full object-cover" />
              ) : (
                <span className="flex size-full items-center justify-center text-xs text-secondary">Still being checked</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {others.map((f) => (
        <p key={f.id} className="flex items-center gap-2 rounded-lg border border-line bg-muted px-3 py-2 text-sm text-ink">
          <Icon name={f.kind === "video" ? "video" : "file"} size={16} className="text-secondary" />
          {f.name ?? (f.kind === "video" ? "Video" : "Document")}
        </p>
      ))}
      {detail.poll && (
        <div className="rounded-lg border border-line p-3 text-sm">
          <p className="font-medium text-ink">{detail.poll.question || "Poll"}</p>
          <ul className="mt-2 flex flex-col gap-1">
            {detail.poll.options.map((o, i) => (
              <li key={i} className="flex justify-between gap-3 text-body">
                <span>{o.label}</span>
                {o.votes !== null && <span className="text-secondary tabular-nums">{o.votes}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {(detail.linkPreview || detail.linkUrl) && (
        <a
          href={detail.linkPreview?.url ?? detail.linkUrl ?? undefined}
          target="_blank"
          rel="noreferrer"
          className="flex flex-col gap-0.5 rounded-lg border border-line px-3 py-2 text-sm hover:bg-muted"
        >
          <span className="font-medium text-ink">{detail.linkPreview?.title ?? detail.linkUrl}</span>
          {detail.linkPreview?.domain && <span className="text-xs text-secondary">{detail.linkPreview.domain}</span>}
        </a>
      )}
    </section>
  );
}

const TYPE_LABELS: Record<ContentCalendarDetail["type"], string> = {
  standard: "Post",
  question: "Question",
  celebration: "Celebration",
  request: "Looking for",
  article: "Article",
};
