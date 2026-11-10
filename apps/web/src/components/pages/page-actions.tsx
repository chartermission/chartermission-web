"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PageDetail, PostView } from "@chartermission/contracts";
import { Button, Icon, buttonClasses } from "@chartermission/ui";
import { CreatePostDialog } from "@/components/compose/create-post-dialog";
import { announceDraftsChanged } from "@/components/drafts/drafts-events";
import { absoluteUrl, pageHref } from "@/components/social/links";
import { Menu, type MenuItem } from "@/components/social/menu";
import { announcePostCreated } from "@/components/social/post-events";
import { toast } from "@/components/social/toast";
import type { Viewer } from "@/components/social/viewer";
import { FollowPageButton } from "./follow-page-button";

/** Header actions on a page: Follow for members; Create post, Edit and Analytics for its admins. */
export function PageActions({ page, viewer }: { page: PageDetail; viewer: Viewer }) {
  const router = useRouter();
  const [composing, setComposing] = useState(0);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(absoluteUrl(pageHref(page.slug)));
      toast.success("Link copied");
    } catch {
      toast.error(new Error("copy"));
    }
  }

  function posted(post: PostView) {
    announcePostCreated(post);
    announceDraftsChanged();
    toast.success(post.status === "pending_media" ? "Posted. Your files are being checked first." : `Posted as ${page.name}`);
    router.refresh();
  }

  const menu: MenuItem[] = [{ label: "Copy link", icon: "link", onSelect: copyLink }];

  return (
    <div className="flex flex-wrap items-center gap-2">
      {page.viewer.canPost && (
        <Button onClick={() => setComposing((n) => n + 1)}>
          <Icon name="plus" size={18} />
          Create post
        </Button>
      )}
      {page.viewer.canEdit && (
        <>
          <Link href={`${pageHref(page.slug)}/edit`} className={buttonClasses({ variant: "secondary" })}>
            Manage page
          </Link>
          {page.status === "active" && (
            <Link href={`/analytics?page=${page.slug}`} className={buttonClasses({ variant: "secondary" })}>
              <Icon name="chart" size={18} />
              Analytics
            </Link>
          )}
        </>
      )}
      {page.status === "active" && !page.viewer.role && <FollowPageButton page={page} following={page.following} size="default" onChange={() => router.refresh()} />}
      <Menu
        label={`More actions for ${page.name}`}
        items={menu}
        trigger={
          <span className="flex size-[42px] items-center justify-center rounded-lg border border-line-strong text-body">
            <Icon name="more" size={20} />
          </span>
        }
      />
      {composing > 0 && (
        <CreatePostDialog key={composing} viewer={viewer} pageId={page.id} onClose={() => setComposing(0)} onPosted={posted} onDraftChange={announceDraftsChanged} />
      )}
    </div>
  );
}
