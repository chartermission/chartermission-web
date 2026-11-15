"use client";

import { openSendInMessage } from "@/components/messages/share-dialog";
import { openShare } from "@/components/social/share-out";
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
import { EnquiryButton } from "./enquiry-dialog";
import { FollowPageButton } from "./follow-page-button";
import { toPageRef } from "./page-ref";
import { useT } from "@/i18n/client";

/**
 * Header actions on a page: Follow and Contact for members; Create post, Manage, Analytics and
 * Enquiries (with the number of new ones) for its admins, plus Availability when it offers
 * bookable services.
 */
export function PageActions({ page, viewer, bookable = false }: { page: PageDetail; viewer: Viewer; bookable?: boolean }) {
  const t = useT();
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
    toast.success(post.status === "pending_media" ? "Posted. Your files are being checked first." : t("Posted as {name}", { name: page.name }));
    router.refresh();
  }

  const menu: MenuItem[] = [
    {
      label: "Share",
      icon: "share",
      onSelect: () =>
        openShare({
          path: pageHref(page.slug),
          title: page.name,
          text: page.tagline ? `${page.name}: ${page.tagline}` : page.name,
          send: { type: "page", key: page.slug },
        }),
    },
    { label: "Copy link", icon: "link", onSelect: copyLink },
    { label: "Send in a message", icon: "send", onSelect: () => openSendInMessage({ type: "page", key: page.slug }) },
    ...(page.viewer.canEdit && bookable ? [{ label: t("Availability"), icon: "calendar" as const, onSelect: () => router.push(`${pageHref(page.slug)}/availability`) }] : []),
  ];
  const newEnquiries = page.newEnquiries ?? 0;

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
            <>
              <Link href={`/analytics?page=${page.slug}`} className={buttonClasses({ variant: "secondary" })}>
                <Icon name="chart" size={18} />
                Analytics
              </Link>
              <Link href={`${pageHref(page.slug)}/enquiries`} className={buttonClasses({ variant: "secondary" })}>
                <Icon name="mail" size={18} />
                Enquiries
                {newEnquiries > 0 && (
                  <span className="min-w-5 rounded-full bg-accent px-1.5 text-center text-xs font-semibold leading-5 text-inverse">
                    <span aria-hidden="true">{newEnquiries > 99 ? "99+" : newEnquiries}</span>
                    <span className="sr-only">{t("{count} new", { count: newEnquiries })}</span>
                  </span>
                )}
              </Link>
            </>
          )}
        </>
      )}
      {page.status === "active" && !page.viewer.role && <FollowPageButton page={page} following={page.following} size="default" onChange={() => router.refresh()} />}
      {page.status === "active" && !page.viewer.role && <EnquiryButton page={toPageRef(page)} label={t("Contact")} />}
      <Menu
        label={t("More actions for {name}", { name: page.name })}
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
