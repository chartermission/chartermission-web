"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { STORY_IMAGE_SECONDS, type MemberRef, type StoryView, type StoryViewer as StoryViewerRow } from "@chartermission/contracts";
import { Avatar, Icon } from "@chartermission/ui";
import { api } from "@/lib/api/client";
import { ReportDialog } from "@/components/moderation/report-dialog";
import { ConfirmDialog } from "@/components/social/confirm-dialog";
import { Dialog } from "@/components/social/dialog";
import { relativeTime } from "@/components/social/format";
import { memberHref } from "@/components/social/links";
import { toast } from "@/components/social/toast";
import { HighlightPicker } from "./highlight-picker";

export type StoryGroup = { key: string; author: MemberRef; stories: StoryView[]; title?: string };

type Sub = "viewers" | "highlight" | "delete" | "report" | null;

/**
 * Full-screen story viewer: progress bars, photo (6 s) or video, caption, tap or arrow keys to move,
 * Space to pause. Authors see who viewed, add to a highlight or delete; others can report.
 * Used for the feed strip (groups of members) and for profile highlights (one group).
 */
export function StoryViewer({
  groups,
  startGroup = 0,
  onClose,
  onSeen,
  onDeleted,
  markViews = true,
  highlightActions,
}: {
  groups: StoryGroup[];
  startGroup?: number;
  onClose: () => void;
  onSeen?: (storyId: string) => void;
  onDeleted?: (storyId: string) => void;
  /** Feed strip: record views. Highlights: don't. */
  markViews?: boolean;
  /** The owner viewing one of their highlights. */
  highlightActions?: { onEdit: () => void; onDelete: () => void };
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [list, setList] = useState(groups);
  const [g, setG] = useState(Math.min(startGroup, Math.max(0, groups.length - 1)));
  const [i, setI] = useState(() => {
    const first = groups[startGroup]?.stories.findIndex((s) => !s.viewer.seen) ?? -1;
    return first > 0 ? first : 0;
  });
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [sub, setSub] = useState<Sub>(null);
  const [viewers, setViewers] = useState<StoryViewerRow[] | null>(null);
  const viewed = useRef(new Set<string>());
  /**
   * Progress of the current story (0–1). It changes every frame, so it lives in a ref and is painted
   * straight onto the active bar (a GPU transform) instead of re-rendering the viewer 60 times a second.
   */
  const progressRef = useRef(0);
  const barRef = useRef<HTMLSpanElement>(null);
  const paint = useCallback((value: number) => {
    progressRef.current = value;
    if (barRef.current) barRef.current.style.transform = `scaleX(${value})`;
  }, []);
  const resetProgress = useCallback(() => paint(0), [paint]);
  /** The photo whose image has loaded: its timer only starts once there is something to look at. */
  const [readyId, setReadyId] = useState<string | null>(null);

  const group = list[g];
  const story = group?.stories[i];
  const holding = paused || sub !== null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    const { overflow } = document.documentElement.style;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = overflow;
    };
  }, []);

  const close = useCallback(() => {
    dialogRef.current?.close();
  }, []);

  const next = useCallback(() => {
    resetProgress();
    const current = list[g];
    if (current && i < current.stories.length - 1) return setI(i + 1);
    if (g < list.length - 1) {
      setG(g + 1);
      setI(0);
      return;
    }
    close();
  }, [list, g, i, close, resetProgress]);

  const prev = useCallback(() => {
    resetProgress();
    if (i > 0) return setI(i - 1);
    if (g > 0) {
      setG(g - 1);
      setI(Math.max(0, (list[g - 1]?.stories.length ?? 1) - 1));
    }
  }, [list, g, i, resetProgress]);

  // Record the view once per story (not the author's own).
  useEffect(() => {
    if (!story || !markViews || story.viewer.own || story.viewer.seen || viewed.current.has(story.id)) return;
    viewed.current.add(story.id);
    api(`/stories/${story.id}/view`, { method: "POST" })
      .then(() => onSeen?.(story.id))
      .catch(() => undefined);
  }, [story, markViews, onSeen]);

  const nextRef = useRef(next);
  useEffect(() => {
    nextRef.current = next;
  }, [next]);

  // Photo timer: 6 seconds of real time once the photo has loaded, advanced every frame, paused while
  // holding or while a dialog is open (it resumes where it stopped).
  const photoReady = !!story && story.media.kind === "image" && readyId === story.id;
  useEffect(() => {
    if (!photoReady || holding) return;
    const total = STORY_IMAGE_SECONDS * 1000;
    let last = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      // At most 100 ms per frame: a background tab pauses frames, and coming back shouldn't skip the photo.
      const value = Math.min(1, progressRef.current + Math.min(now - last, 100) / total);
      last = now;
      paint(value);
      if (value >= 1) nextRef.current();
      else frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [photoReady, holding, paint]);

  // Video: follow the playhead every frame (timeupdate only fires about four times a second).
  const isVideo = story?.media.kind === "video";
  useEffect(() => {
    if (!isVideo || holding) return;
    let frame = requestAnimationFrame(function tick() {
      const v = videoRef.current;
      if (v && v.duration) paint(Math.min(1, v.currentTime / v.duration));
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [isVideo, holding, story?.id, paint]);

  // Video play/pause follows the hold state.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (holding) video.pause();
    else
      video.play().catch(() => {
        // Autoplay with sound was blocked: retry muted.
        setMuted(true);
        video.muted = true;
        void video.play().catch(() => undefined);
      });
  }, [holding, story]);

  function onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (sub) return;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      next();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      prev();
    } else if (event.key === " " && event.target === event.currentTarget) {
      event.preventDefault();
      setPaused((p) => !p);
    }
  }

  function removeStory(id: string) {
    onDeleted?.(id);
    resetProgress();
    const updated = list.map((grp) => ({ ...grp, stories: grp.stories.filter((s) => s.id !== id) })).filter((grp) => grp.stories.length > 0);
    if (!updated.length) {
      setList(updated);
      close();
      return;
    }
    const sameGroup = updated.findIndex((grp) => grp.key === group?.key);
    if (sameGroup >= 0) {
      setG(sameGroup);
      setI(Math.min(i, updated[sameGroup]!.stories.length - 1));
    } else {
      setG(Math.min(g, updated.length - 1));
      setI(0);
    }
    setList(updated);
  }

  async function openViewers() {
    if (!story) return;
    setSub("viewers");
    setViewers(null);
    try {
      setViewers(await api<StoryViewerRow[]>(`/stories/${story.id}/viewers`));
    } catch (e) {
      toast.error(e);
      setSub(null);
    }
  }

  const label = group?.title ? `${group.title} highlight` : group ? `${group.author.name}’s story` : "Story";

  return (
    <dialog
      ref={dialogRef}
      aria-label={label}
      onClose={(event) => {
        // Dialogs opened from here (viewers, report, delete) close too; only this one's own close counts.
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={onKeyDown}
      className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none bg-ink/95 p-0 text-inverse backdrop:bg-ink/90"
    >
      {group && story && (
        <div className="flex h-full w-full items-center justify-center sm:py-4">
          <div className="relative flex aspect-[9/16] h-full max-h-full max-w-full flex-col overflow-hidden bg-ink sm:rounded-2xl">
            {story.media.kind === "video" ? (
              <video
                key={story.id}
                ref={videoRef}
                src={story.media.url}
                poster={story.media.posterUrl ?? undefined}
                muted={muted}
                playsInline
                autoPlay
                preload="auto"
                onEnded={next}
                aria-label={story.caption ?? "Video story"}
                className="absolute inset-0 size-full object-contain"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- permission-checked media URL
              <img
                key={story.id}
                src={story.media.url}
                alt={story.caption ?? `Photo story from ${group.author.name}`}
                onLoad={() => setReadyId(story.id)}
                onError={() => setReadyId(story.id)}
                className="absolute inset-0 size-full object-contain"
              />
            )}

            <button type="button" onClick={prev} className="absolute inset-y-0 left-0 z-10 w-1/3 cursor-w-resize focus-visible:outline-none" aria-label="Previous story" />
            <button type="button" onClick={next} className="absolute inset-y-0 right-0 z-10 w-2/3 cursor-e-resize focus-visible:outline-none" aria-label="Next story" />

            <div className="pointer-events-none relative z-20 flex flex-col gap-3 bg-gradient-to-b from-ink/70 to-transparent px-3 pb-8 pt-3">
              <div className="flex gap-1" aria-hidden="true">
                {group.stories.map((s, index) => (
                  <span key={s.id} className="h-[3px] flex-1 overflow-hidden rounded-full bg-inverse/35">
                    <span
                      key={index === i ? `active-${s.id}` : s.id}
                      ref={index === i ? barRef : undefined}
                      className="block h-full w-full origin-left rounded-full bg-inverse will-change-transform"
                      style={{ transform: `scaleX(${index < i ? 1 : index === i ? progressRef.current : 0})` }}
                    />
                  </span>
                ))}
              </div>
              <p className="sr-only" aria-live="polite">
                {group.title ? `${group.title}: ` : ""}story {i + 1} of {group.stories.length} from {group.author.name}
              </p>
              <div className="pointer-events-auto flex items-center gap-2.5">
                <Link href={memberHref(group.author.handle)} className="flex min-w-0 items-center gap-2 rounded-md hover:underline">
                  <Avatar name={group.author.name} src={group.author.avatarUrl ?? undefined} tone={group.author.tone} size={32} />
                  <span className="truncate text-sm font-semibold">{group.title ?? group.author.name}</span>
                </Link>
                <time dateTime={story.createdAt} className="shrink-0 text-xs text-inverse/75" suppressHydrationWarning>
                  {relativeTime(story.createdAt)}
                </time>
                <span className="ml-auto flex shrink-0 items-center gap-1">
                  {story.media.kind === "video" && (
                    <button type="button" onClick={() => setMuted((m) => !m)} className="rounded-md p-1.5 hover:bg-inverse/15" aria-label={muted ? "Unmute" : "Mute"} aria-pressed={!muted}>
                      <SoundIcon muted={muted} />
                    </button>
                  )}
                  <button type="button" onClick={() => setPaused((p) => !p)} className="rounded-md p-1.5 hover:bg-inverse/15" aria-label={paused ? "Play" : "Pause"}>
                    <PlayPauseIcon paused={paused} />
                  </button>
                  {story.viewer.canReport && (
                    <button type="button" onClick={() => setSub("report")} className="rounded-md p-1.5 hover:bg-inverse/15" aria-label="Report this story">
                      <Icon name="flag" size={18} />
                    </button>
                  )}
                  <button type="button" onClick={close} className="rounded-md p-1.5 hover:bg-inverse/15" aria-label="Close stories">
                    <Icon name="x" size={22} />
                  </button>
                </span>
              </div>
            </div>

            <div className="relative z-20 mt-auto flex flex-col gap-3 bg-gradient-to-t from-ink/80 to-transparent px-4 pb-4 pt-10">
              {story.moderationState && story.moderationState !== "visible" && (
                <p className="rounded-md bg-warning px-3 py-2 text-xs text-ink">
                  Only you can see this story: it was {story.moderationState} by a moderator.
                </p>
              )}
              {story.caption && <p className="whitespace-pre-line break-words text-sm">{story.caption}</p>}
              {(story.viewer.own || highlightActions) && (
                <div className="flex flex-wrap items-center gap-2">
                  {story.viewer.own && story.viewCount !== null && (
                    <button type="button" onClick={openViewers} className="flex items-center gap-1.5 rounded-full bg-inverse/15 px-3 py-1.5 text-xs font-medium hover:bg-inverse/25">
                      <Icon name="eye" size={14} />
                      {story.viewCount} {story.viewCount === 1 ? "view" : "views"}
                    </button>
                  )}
                  {story.viewer.own && !highlightActions && (
                    <button type="button" onClick={() => setSub("highlight")} className="flex items-center gap-1.5 rounded-full bg-inverse/15 px-3 py-1.5 text-xs font-medium hover:bg-inverse/25">
                      <Icon name="bookmark" size={14} />
                      {story.highlightIds?.length ? "In a highlight" : "Add to highlight"}
                    </button>
                  )}
                  {highlightActions && (
                    <>
                      <button type="button" onClick={highlightActions.onEdit} className="flex items-center gap-1.5 rounded-full bg-inverse/15 px-3 py-1.5 text-xs font-medium hover:bg-inverse/25">
                        Edit highlight
                      </button>
                      <button type="button" onClick={highlightActions.onDelete} className="flex items-center gap-1.5 rounded-full bg-inverse/15 px-3 py-1.5 text-xs font-medium hover:bg-inverse/25">
                        Delete highlight
                      </button>
                    </>
                  )}
                  {story.viewer.canDelete && !highlightActions && (
                    <button type="button" onClick={() => setSub("delete")} className="ml-auto flex items-center gap-1.5 rounded-full bg-inverse/15 px-3 py-1.5 text-xs font-medium hover:bg-error">
                      Delete
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {sub === "viewers" && story && (
        <Dialog title="Viewed by" description="Members who opened this story" onClose={() => setSub(null)} width={420}>
          {viewers === null ? (
            <p className="text-sm text-secondary">Loading…</p>
          ) : viewers.length === 0 ? (
            <p className="text-sm text-secondary">No views yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {viewers.map((v) => (
                <li key={v.member.id} className="flex items-center gap-3">
                  <Avatar name={v.member.name} src={v.member.avatarUrl ?? undefined} tone={v.member.tone} size={32} />
                  <Link href={memberHref(v.member.handle)} className="min-w-0 flex-1 truncate text-sm font-medium text-ink hover:underline">
                    {v.member.name}
                  </Link>
                  <time dateTime={v.viewedAt} className="shrink-0 text-xs text-secondary" suppressHydrationWarning>
                    {relativeTime(v.viewedAt)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </Dialog>
      )}
      {sub === "highlight" && story && (
        <HighlightPicker
          story={story}
          onClose={() => setSub(null)}
          onAdded={(highlightId) => {
            setList((current) =>
              current.map((grp) => ({
                ...grp,
                stories: grp.stories.map((s) => (s.id === story.id ? { ...s, highlightIds: [...new Set([...(s.highlightIds ?? []), highlightId])] } : s)),
              })),
            );
          }}
        />
      )}
      {sub === "delete" && story && (
        <ConfirmDialog
          title="Delete this story?"
          confirmLabel="Delete story"
          danger
          onConfirm={async () => {
            await api(`/stories/${story.id}`, { method: "DELETE" });
            removeStory(story.id);
          }}
          onClose={() => setSub(null)}
        >
          It disappears from the strip and from any highlight it is in.
        </ConfirmDialog>
      )}
      {sub === "report" && story && (
        <ReportDialog targetType="story" targetId={story.id} subject={`${story.author.name}’s story`} onClose={() => setSub(null)} />
      )}
    </dialog>
  );
}

function PlayPauseIcon({ paused }: { paused: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor">
      {paused ? <path d="M8 5.5v13l11-6.5z" /> : <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />}
    </svg>
  );
}

function SoundIcon({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor" />
      {muted ? <path d="m16 9 5 6M21 9l-5 6" /> : <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />}
    </svg>
  );
}
