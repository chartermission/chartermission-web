"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { PostView } from "@chartermission/contracts";
import { Composer, blockedReason, type ComposeStart } from "@/components/composer";
import { writeArticleHref } from "@/components/articles/write-article";
import { CreatePostDialog } from "@/components/compose/create-post-dialog";
import { announceDraftsChanged } from "@/components/drafts/drafts-events";
import { onComposeRequest } from "@/components/home/compose-request";
import { announcePostCreated } from "@/components/social/post-events";
import { toast } from "@/components/social/toast";
import type { Viewer } from "@/components/social/viewer";
import { useT, useIntlTag } from "@/i18n/client";

type Session = { key: number; body?: string } & ComposeStart;

/**
 * Composer wired to the create-post dialog (Figma "Web / Create post — modal", node 19:2951).
 * Also opens it for `/feed?compose=1` (then drops the parameter from the URL) and for
 * requestCompose() calls from the welcome strip and the daily prompt card.
 */
export function FeedComposer({ viewer, compose = false }: { viewer: Viewer; compose?: boolean }) {
  const intl = useIntlTag();
  const t = useT();
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const blocked = !!blockedReason(intl, t, viewer);

  useEffect(() => {
    const open = (start: Omit<Session, "key">) => {
      if (blocked) {
        // The composer explains why posting is unavailable; bring it into view instead.
        panelRef.current?.scrollIntoView({ block: "center" });
        return;
      }
      setSession((current) => current ?? { key: Date.now(), ...start });
    };
    if (compose) {
      open({});
      const url = new URL(window.location.href);
      url.searchParams.delete("compose");
      router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false });
    }
    return onComposeRequest((request) => open({ body: request.body }));
  }, [compose, blocked, router]);

  function posted(post: PostView) {
    announcePostCreated(post);
    announceDraftsChanged();
    toast.success(
      post.status === "pending_media"
        ? "Posted. Your files are being checked; others will see the post once that finishes."
        : post.status === "in_review"
          ? "Sent to the chapter team for approval. You’ll be told when it’s live."
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
      <div ref={panelRef}>
        <Composer
          viewer={viewer}
          onOpen={(start) => {
            // Articles are written on their own page.
            if (start?.type === "article") router.push(writeArticleHref());
            else setSession((current) => ({ key: (current?.key ?? 0) + 1, ...start }));
          }}
        />
      </div>
      {session && (
        <CreatePostDialog
          key={session.key}
          viewer={viewer}
          initialTool={session.tool}
          initialType={session.type}
          initialBody={session.body}
          onClose={() => setSession(null)}
          onPosted={posted}
          onDraftChange={announceDraftsChanged}
        />
      )}
    </>
  );
}
