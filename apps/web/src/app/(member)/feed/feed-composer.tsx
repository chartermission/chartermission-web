"use client";

import { useState } from "react";
import type { PostView } from "@chartermission/contracts";
import { Composer } from "@/components/composer";
import { CreatePostDialog, type ComposeTool } from "@/components/compose/create-post-dialog";
import { announcePostCreated } from "@/components/social/post-events";
import { toast } from "@/components/social/toast";
import type { Viewer } from "@/components/social/viewer";

/** Composer wired to the create-post dialog (Figma "Web / Create post — modal", node 19:2951). */
export function FeedComposer({ viewer }: { viewer: Viewer }) {
  const [session, setSession] = useState<{ key: number; tool?: ComposeTool } | null>(null);

  function posted(post: PostView) {
    announcePostCreated(post);
    toast.success(
      post.status === "pending_media"
        ? "Posted. Your files are being checked; others will see the post once that finishes."
        : post.kind === "announcement"
          ? "Announcement published and pinned for all members"
          : post.poll
            ? "Your poll is live"
            : "Your post is live",
    );
  }

  return (
    <>
      <Composer viewer={viewer} onOpen={(tool) => setSession((current) => ({ key: (current?.key ?? 0) + 1, tool }))} />
      {session && <CreatePostDialog key={session.key} viewer={viewer} initialTool={session.tool} onClose={() => setSession(null)} onPosted={posted} />}
    </>
  );
}
