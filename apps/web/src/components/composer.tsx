"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { DraftView, Page, PostType } from "@chartermission/contracts";
import { Avatar, Button, Icon, Panel, type IconName } from "@chartermission/ui";
import { onDraftsChanged } from "@/components/drafts/drafts-events";
import { api } from "@/lib/api/client";
import { VerifyEmailPrompt } from "@/components/social/errors";
import { onPostCreated } from "@/components/social/post-events";
import { absoluteDateTime } from "@/components/social/format";
import { activeUntil, type Viewer } from "@/components/social/viewer";
import type { ComposeTool } from "@/components/compose/create-post-dialog";
import { postTypeMeta } from "@/components/social/post-types/meta";

/** What the composer opens with: a tool on a standard post, or another post type. */
export type ComposeStart = { tool?: ComposeTool; type?: PostType };

const starts: { start: ComposeStart; icon: IconName; label: string; color: string }[] = [
  { start: { tool: "photo" }, icon: "image", label: "Photo", color: "text-info" },
  { start: { tool: "poll" }, icon: "chart", label: "Poll", color: "text-accent" },
  { start: { type: "question" }, icon: postTypeMeta.question.icon, label: postTypeMeta.question.label, color: "text-warning" },
  { start: { type: "celebration" }, icon: postTypeMeta.celebration.icon, label: postTypeMeta.celebration.label, color: "text-accent-hover" },
  { start: { type: "request" }, icon: postTypeMeta.request.icon, label: postTypeMeta.request.label, color: "text-success" },
  { start: { type: "article" }, icon: postTypeMeta.article.icon, label: postTypeMeta.article.label, color: "text-primary-light" },
];

/** Why the viewer can't post right now, if anything (unverified, restricted or suspended). */
export function blockedReason(viewer: Viewer) {
  if (!viewer.emailVerified) return { kind: "verify" as const };
  if (viewer.status === "suspended") return { kind: "standing" as const, text: "Your account is suspended, so you can’t post." };
  const until = activeUntil(viewer.restrictions.postingUntil);
  if (until) return { kind: "standing" as const, text: `You can’t post until ${absoluteDateTime(until)}.` };
  return null;
}

/** How many drafts and scheduled posts the member has (≤ MAX_DRAFTS, so one page each holds them all). */
function useDraftCounts() {
  const [counts, setCounts] = useState<{ drafts: number; scheduled: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    let last = 0;
    const refresh = async () => {
      if (Date.now() - last < 2_000) return;
      last = Date.now();
      try {
        const [drafts, scheduled] = await Promise.all([
          api<Page<DraftView>>("/me/drafts", { query: { status: "draft", limit: 50 } }),
          api<Page<DraftView>>("/me/drafts", { query: { status: "scheduled", limit: 50 } }),
        ]);
        if (!cancelled) setCounts({ drafts: drafts.items.length, scheduled: scheduled.items.length });
      } catch {
        // The links are a convenience; leave them out if the counts can't load.
      }
    };
    const onVisible = () => document.visibilityState === "visible" && void refresh();
    void refresh();
    const offDrafts = onDraftsChanged(() => {
      last = 0;
      void refresh();
    });
    const offPosts = onPostCreated(() => {
      last = 0;
      void refresh();
    });
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      offDrafts();
      offPosts();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return counts;
}

/** Quiet "Drafts (n) · Scheduled (n)" links, shown only when there is something to open. */
function DraftLinks({ counts }: { counts: { drafts: number; scheduled: number } | null }) {
  if (!counts || (!counts.drafts && !counts.scheduled)) return null;
  const link = "whitespace-nowrap rounded-sm text-xs font-medium text-secondary hover:text-primary hover:underline";
  return (
    <nav aria-label="Your unpublished posts" className="flex items-center gap-1.5">
      {counts.drafts > 0 && (
        <Link href="/drafts" className={link}>
          Drafts ({counts.drafts})
        </Link>
      )}
      {counts.drafts > 0 && counts.scheduled > 0 && (
        <span aria-hidden="true" className="text-xs text-disabled">
          ·
        </span>
      )}
      {counts.scheduled > 0 && (
        <Link href="/drafts?tab=scheduled" className={link}>
          Scheduled ({counts.scheduled})
        </Link>
      )}
    </nav>
  );
}

/** "Share an update" box at the top of the feed. Opens the create-post dialog. */
export function Composer({ viewer, onOpen }: { viewer: Viewer; onOpen?: (start?: ComposeStart) => void }) {
  const blocked = blockedReason(viewer);
  const counts = useDraftCounts();
  return (
    <Panel aria-label="Create a post" className="flex flex-col gap-3.5 p-4">
      <div className="flex items-center gap-3">
        <Avatar name={viewer.name} src={viewer.avatarUrl ?? undefined} tone={viewer.tone} />
        <button
          type="button"
          disabled={!!blocked}
          onClick={() => onOpen?.()}
          className="flex h-11 min-w-0 flex-1 items-center rounded-[22px] bg-muted px-4 text-left text-sm text-disabled hover:bg-primary-tint-2 disabled:cursor-not-allowed disabled:hover:bg-muted"
        >
          <span className="truncate">Share an update, ask a question or start a poll…</span>
        </button>
      </div>
      {blocked ? (
        <div role="note" className="flex items-start gap-2.5 rounded-lg bg-warning-light px-3 py-2.5">
          <Icon name={blocked.kind === "verify" ? "mail" : "shield"} size={18} className="mt-0.5 shrink-0 text-warning" />
          {blocked.kind === "verify" ? (
            <VerifyEmailPrompt message="Verify your email address to post, comment and react. You can read the feed in the meantime." />
          ) : (
            <p className="text-sm text-ink">
              {blocked.text}{" "}
              <Link href="/settings/moderation" className="font-medium text-primary-light hover:underline">
                See why and how to appeal
              </Link>
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 max-sm:gap-x-3">
            {starts.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => onOpen?.(item.start)}
                className="flex items-center gap-1.5 rounded-md text-sm font-medium text-body hover:text-ink"
              >
                <Icon name={item.icon} size={18} className={item.color} />
                <span className="max-sm:sr-only">{item.label}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <DraftLinks counts={counts} />
            <Button size="small" onClick={() => onOpen?.()}>
              Post
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}
