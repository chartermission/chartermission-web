"use client";

import { useState } from "react";
import type { PostView } from "@chartermission/contracts";
import { Composer, type ComposeStart } from "@/components/composer";
import { CreatePostDialog } from "@/components/compose/create-post-dialog";
import { announceDraftsChanged } from "@/components/drafts/drafts-events";
import { announcePostCreated } from "@/components/social/post-events";
import { toast } from "@/components/social/toast";
import type { Viewer } from "@/components/social/viewer";

/** Composer wired to the create-post dialog (Figma "Web / Create post — modal", node 19:2951). */
export function FeedComposer({ viewer }: { viewer: Viewer }) {
  const [session, setSession] = useState<({ key: number } & ComposeStart) | null>(null);

  function posted(post: PostView) {
    announcePostCreated(post);
    announceDraftsChanged();
    toast.success(
      post.status === "pending_media"
        ? "Posted. Your files are being checked; others will see the post once that finishes."
        : post.kind === "announcement"
          ? "Announcement published and pinned for all members"
          : post.poll
            ? "Your poll is live"
            : post.type === "question"
              ? "Your question is live"
              : post.type === "celebration"
                ? "Your milestone is live"
                : post.type === "request"
                  ? "Your request is live"
              : post.type === "article"
                ? "Your article is published"
                : "Your post is live",
    );
  }

  return (
    <>
      <Composer viewer={viewer} onOpen={(start) => setSession((current) => ({ key: (current?.key ?? 0) + 1, ...start }))} />
      {session && (
        <CreatePostDialog
          key={session.key}
          viewer={viewer}
          initialTool={session.tool}
          initialType={session.type}
          onClose={() => setSession(null)}
          onPosted={posted}
          onDraftChange={announceDraftsChanged}
        />
      )}
    </>
  );
}
