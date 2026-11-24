"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { GroupDetail, GroupPostAction, Page, PostView } from "@chartermission/contracts";
import { Icon } from "@chartermission/ui";
import { NoteDialog } from "@/components/chapters/chapter-moderation";
import { Composer, blockedReason, type ComposeStart } from "@/components/composer";
import { CreatePostDialog } from "@/components/compose/create-post-dialog";
import { announceDraftsChanged } from "@/components/drafts/drafts-events";
import type { MenuItem } from "@/components/social/menu";
import { announcePostCreated, announcePostRemoved } from "@/components/social/post-events";
import { PostStream } from "@/components/social/post-stream";
import { EmptyState } from "@/components/social/skeletons";
import { toast } from "@/components/social/toast";
import type { Viewer } from "@/components/social/viewer";
import { useIntlTag, useT } from "@/i18n/client";
import { api } from "@/lib/api/client";
import { LockIcon } from "./group-parts";
import { JoinGroupButton } from "./join-group-button";

/** POST /groups/{slug}/posts/{postId}: moderators approve, decline, remove, pin or unpin. */
export function groupPostAction(slug: string, postId: string, input: GroupPostAction) {
  return api(`/groups/${slug}/posts/${postId}`, { method: "POST", body: input });
}

type Session = { key: number } & ComposeStart;

/**
 * A group's Posts tab: the composer (when the viewer may post), a note when posts wait for
 * approval, then the group's posts (pinned first) as the reader scrolls. Moderators get pin,
 * unpin and "Remove from group" in each post's menu.
 */
export function GroupPosts({ group, viewer, initial, limit }: { group: GroupDetail; viewer: Viewer; initial?: Page<PostView>; limit: number }) {
  const t = useT();
  const intl = useIntlTag();
  const [session, setSession] = useState<Session | null>(null);
  const [removing, setRemoving] = useState<PostView | null>(null);
  const { abilities } = group;
  const blocked = !!blockedReason(intl, t, viewer);
  const reviewed = group.postApproval && !abilities.moderate;
  const ref = { id: group.id, slug: group.slug, name: group.name, visibility: group.visibility, logoUrl: group.logoUrl };

  function posted(post: PostView) {
    announcePostCreated(post);
    announceDraftsChanged();
    toast.success(
      post.status === "pending_media"
        ? t("Posted. Your files are being checked first.")
        : post.groupReview?.state === "pending" || post.status === "in_review"
          ? t("Sent to the group’s admins for approval. You’ll be told when it’s live.")
          : t("Posted to {group}", { group: group.name }),
    );
  }

  async function pin(post: PostView, on: boolean) {
    try {
      await groupPostAction(group.slug, post.id, { action: on ? "pin" : "unpin" });
      toast.success(on ? t("Pinned to the top of the group") : t("Unpinned"));
    } catch (e) {
      toast.error(e);
    }
  }

  const extraMenu = (post: PostView): MenuItem[] => {
    if (!abilities.moderate || post.group?.id !== group.id || post.status !== "published") return [];
    const items: MenuItem[] = [post.pinned ? { label: t("Unpin from group"), icon: "pin", onSelect: () => pin(post, false) } : { label: t("Pin to group"), icon: "pin", onSelect: () => pin(post, true) }];
    if (post.author.id !== viewer.id) items.push({ label: t("Remove from group"), icon: "x", danger: true, onSelect: () => setRemoving(post) });
    return items;
  };

  return (
    <>
      <h2 className="sr-only">{t("Posts")}</h2>
      {abilities.post && group.status === "active" && (
        <>
          <Composer viewer={viewer} onOpen={(start) => !blocked && setSession((current) => ({ key: (current?.key ?? 0) + 1, ...start }))} />
          {reviewed && (
            <p className="-mt-2 flex items-center gap-1.5 px-1 text-xs text-secondary">
              <Icon name="shield" size={14} />
              {t("Posts in this group are approved by its admins before other members see them.")}
            </p>
          )}
        </>
      )}
      {!abilities.post && group.membership.status === "active" && group.postPermission === "admins" && group.status === "active" && (
        <p className="flex items-center gap-1.5 px-1 text-xs text-secondary">
          <Icon name="info" size={14} />
          {t("Only the group’s admins and moderators post here.")}
        </p>
      )}
      {session && (
        <CreatePostDialog
          key={session.key}
          viewer={viewer}
          group={ref}
          initialTool={session.tool}
          initialType={session.type === "article" ? undefined : session.type}
          onClose={() => setSession(null)}
          onPosted={posted}
          onDraftChange={announceDraftsChanged}
        />
      )}

      <PostStream
        path="/feed"
        label={t("Posts in {group}", { group: group.name })}
        query={{ group: group.slug, limit }}
        initial={initial}
        viewer={viewer}
        acceptNew={abilities.post}
        acceptCreated={(post) => post.group?.id === group.id}
        extraMenu={extraMenu}
        empty={
          <EmptyState icon="message" title={t("No posts yet")}>
            {abilities.post ? t("Start the conversation: share an update or ask the group a question.") : t("Posts members share in this group will appear here.")}
          </EmptyState>
        }
      />

      {removing && (
        <NoteDialog
          title={t("Remove this post from the group?")}
          description={t("Members will no longer see it. {name} is told. If it breaks the community guidelines, report it too.", { name: removing.author.name })}
          label={t("Note for the author (optional)")}
          confirmLabel={t("Remove post")}
          danger
          maxLength={500}
          onConfirm={async (note) => {
            await groupPostAction(group.slug, removing.id, { action: "remove", note: note || undefined });
            announcePostRemoved(removing.id);
            toast.success(t("Removed from the group. The author has been told."));
          }}
          onClose={() => setRemoving(null)}
        />
      )}
    </>
  );
}

/** What a private group shows people who aren't members: a lock and the way in. */
export function LockedPosts({ group }: { group: GroupDetail }) {
  const t = useT();
  const router = useRouter();
  const invited = group.membership.status === "invited";
  const pending = group.membership.status === "pending";
  if (group.status === "suspended") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-card border border-line bg-card px-6 py-10 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-primary-tint-2 text-primary-light">
          <LockIcon size={24} />
        </span>
        <p className="text-md font-medium text-ink">{t("This group’s posts are hidden while it is suspended.")}</p>
        <p className="max-w-md text-sm text-secondary">{t("Only the Charter Mission team can see them until the group is restored.")}</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-line bg-card px-6 py-10 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-primary-tint-2 text-primary-light">
        <LockIcon size={24} />
      </span>
      <p className="text-md font-medium text-ink">
        {invited
          ? t("You’re invited to this private group. Accept to see its posts.")
          : pending
            ? t("Your request to join is waiting for the group’s admins.")
            : t("This group is private. Ask to join to see posts.")}
      </p>
      <p className="max-w-md text-sm text-secondary">{t("Only members see the group’s posts and who is in it. Anyone can see what it’s about and who runs it.")}</p>
      {group.abilities.join !== "none" && !pending && <JoinGroupButton group={group} membership={group.membership} size="default" onChange={() => router.refresh()} />}
    </div>
  );
}
