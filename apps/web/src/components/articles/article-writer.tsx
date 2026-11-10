"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { DraftView, PostView } from "@chartermission/contracts";
import { CreatePostDialog } from "@/components/compose/create-post-dialog";
import { announceDraftsChanged } from "@/components/drafts/drafts-events";
import { articleHref } from "@/components/social/links";
import { announcePostCreated } from "@/components/social/post-events";
import { toast } from "@/components/social/toast";
import type { Viewer } from "@/components/social/viewer";
import { takeArticleSeed, type ArticleSeed } from "./write-article";

/**
 * The article writing page: the composer laid out as a page (title, cover, editor with preview,
 * autosaved drafts, scheduling). Publishing opens the article; closing goes back to where the
 * member came from (their drafts when they were editing one, otherwise Articles).
 */
export function ArticleWriter({ viewer, draft }: { viewer: Viewer; draft?: DraftView }) {
  const router = useRouter();
  // Text carried over from the post dialog, read once on the first render in the browser.
  const [seed] = useState<ArticleSeed | null>(() => (draft || typeof window === "undefined" ? null : takeArticleSeed()));

  function posted(post: PostView) {
    announcePostCreated(post);
    announceDraftsChanged();
    toast.success(
      post.status === "pending_media"
        ? "Published. Your cover is being checked; others will see the article once that finishes."
        : "Your article is published",
    );
    router.push(post.type === "article" ? articleHref(post.id) : `/posts/${post.id}`);
  }

  return (
    <CreatePostDialog
      presentation="page"
      viewer={viewer}
      initialType="article"
      initialBody={seed?.text || undefined}
      pageId={seed?.pageId}
      draft={draft}
      onDraftChange={announceDraftsChanged}
      onPosted={posted}
      onClose={() => router.push(draft ? "/drafts" : "/articles")}
    />
  );
}
