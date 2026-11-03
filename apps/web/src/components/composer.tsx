"use client";

import Link from "next/link";
import { Avatar, Button, Icon, Panel, type IconName } from "@chartermission/ui";
import { VerifyEmailPrompt } from "@/components/social/errors";
import { absoluteDateTime } from "@/components/social/format";
import { activeUntil, type Viewer } from "@/components/social/viewer";
import type { ComposeTool } from "@/components/compose/create-post-dialog";

const tools: { tool: ComposeTool; icon: IconName; label: string; color: string }[] = [
  { tool: "photo", icon: "image", label: "Photo", color: "text-info" },
  { tool: "link", icon: "link", label: "Link", color: "text-success" },
  { tool: "poll", icon: "chart", label: "Poll", color: "text-accent" },
  { tool: "topic", icon: "hash", label: "Topic", color: "text-primary-light" },
];

/** Why the viewer can't post right now, if anything (unverified, restricted or suspended). */
function blockedReason(viewer: Viewer) {
  if (!viewer.emailVerified) return { kind: "verify" as const };
  if (viewer.status === "suspended") return { kind: "standing" as const, text: "Your account is suspended, so you can’t post." };
  const until = activeUntil(viewer.restrictions.postingUntil);
  if (until) return { kind: "standing" as const, text: `You can’t post until ${absoluteDateTime(until)}.` };
  return null;
}

/** "Share an update" box at the top of the feed. Opens the create-post dialog. */
export function Composer({ viewer, onOpen }: { viewer: Viewer; onOpen?: (tool?: ComposeTool) => void }) {
  const blocked = blockedReason(viewer);
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
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 sm:gap-5">
            {tools.map((item) => (
              <button
                key={item.tool}
                type="button"
                onClick={() => onOpen?.(item.tool)}
                className="flex items-center gap-1.5 rounded-md text-sm font-medium text-body hover:text-ink"
              >
                <Icon name={item.icon} size={18} className={item.color} />
                <span className="max-sm:sr-only">{item.label}</span>
              </button>
            ))}
          </div>
          <Button size="small" onClick={() => onOpen?.()}>
            Post
          </Button>
        </div>
      )}
    </Panel>
  );
}
