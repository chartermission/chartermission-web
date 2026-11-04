"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PostView } from "@chartermission/contracts";
import { Button, Icon, type ButtonProps } from "@chartermission/ui";
import { CreatePostDialog } from "@/components/compose/create-post-dialog";
import { announceDraftsChanged } from "@/components/drafts/drafts-events";
import { absoluteDateTime } from "@/components/social/format";
import { articleHref } from "@/components/social/links";
import { announcePostCreated } from "@/components/social/post-events";
import { toast } from "@/components/social/toast";
import { activeUntil, type Viewer } from "@/components/social/viewer";

/** Why the viewer can't publish right now, if anything. */
function blockedReason(viewer: Viewer): string | null {
  if (!viewer.emailVerified) return "Verify your email address to publish articles.";
  if (viewer.status === "suspended") return "Your account is suspended, so you can’t publish.";
  const until = activeUntil(viewer.restrictions.postingUntil);
  return until ? `You can’t post until ${absoluteDateTime(until)}.` : null;
}

/**
 * "Write an article": opens the create-post dialog on the article type. After publishing,
 * the new article opens on its reader page.
 */
export function WriteArticleButton({
  viewer,
  label = "Write an article",
  variant = "primary",
  size = "default",
}: {
  viewer: Viewer;
  label?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
}) {
  const router = useRouter();
  const [session, setSession] = useState(0);
  const blocked = blockedReason(viewer);

  function posted(post: PostView) {
    announcePostCreated(post);
    announceDraftsChanged();
    toast.success(
      post.status === "pending_media"
        ? "Published. Your cover is being checked; others will see the article once that finishes."
        : "Your article is published",
    );
    if (post.type === "article") router.push(articleHref(post.id));
  }

  return (
    <>
      <Button variant={variant} size={size} disabled={!!blocked} title={blocked ?? undefined} onClick={() => setSession((n) => n + 1)}>
        <Icon name="plus" size={size === "small" ? 16 : 18} />
        {label}
        {blocked && <span className="sr-only"> ({blocked})</span>}
      </Button>
      {session > 0 && (
        <CreatePostDialog
          key={session}
          viewer={viewer}
          initialType="article"
          onClose={() => setSession(0)}
          onPosted={posted}
          onDraftChange={announceDraftsChanged}
        />
      )}
    </>
  );
}
