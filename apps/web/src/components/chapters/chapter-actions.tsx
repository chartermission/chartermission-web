"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  CHAPTER_ABOUT_MAX_CHARS,
  CHAPTER_PIN_LIMIT,
  type ChapterDetail,
  type ChapterPin,
  type MemberRef,
  type Page,
  type PostView,
} from "@chartermission/contracts";
import Link from "next/link";
import { Button, Chip, Icon, Panel, buttonClasses, cn } from "@chartermission/ui";
import { Composer, blockedReason, type ComposeStart } from "@/components/composer";
import { CreatePostDialog } from "@/components/compose/create-post-dialog";
import { announceDraftsChanged } from "@/components/drafts/drafts-events";
import { ErrorNotice } from "@/components/social/errors";
import { topicHref } from "@/components/social/links";
import type { MenuItem } from "@/components/social/menu";
import { PostCard } from "@/components/social/post-card";
import { announcePostCreated } from "@/components/social/post-events";
import { AuthorName, MemberAvatar } from "@/components/social/post-parts";
import { PostStream } from "@/components/social/post-stream";
import { EmptyState } from "@/components/social/skeletons";
import { Menu } from "@/components/social/menu";
import { announcePostRemoved } from "@/components/social/post-events";
import { toast } from "@/components/social/toast";
import type { Viewer } from "@/components/social/viewer";
import { useT, T, useIntlTag } from "@/i18n/client";
import { api } from "@/lib/api/client";
import { ChapterBans, NoteDialog, announceChapterModeration, reviewPost } from "./chapter-moderation";

/** "Join chapter" / "Member" on the chapter header (joining is following the chapter). */
export function JoinChapterButton({ chapter, following: initial, banned = false }: { chapter: Pick<ChapterDetail, "id" | "name">; following: boolean; banned?: boolean }) {
  const router = useRouter();
  const t = useT();
  const [following, setFollowing] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    const next = !following;
    setBusy(true);
    setFollowing(next);
    try {
      await api("/follows", { method: next ? "POST" : "DELETE", body: { targetType: "chapter", targetId: chapter.id } });
      toast.success(next ? t("You joined {name}", { name: chapter.name }) : t("You left {name}", { name: chapter.name }));
      router.refresh();
    } catch (e) {
      setFollowing(!next);
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }

  if (banned) {
    return (
      <p className="flex items-center gap-1.5 rounded-lg border border-line px-3.5 py-2 text-sm text-secondary">
        <Icon name="ban" size={16} />
        {t("You can’t join this chapter")}
      </p>
    );
  }
  return (
    <button
      type="button"
      aria-pressed={following}
      aria-disabled={busy}
      onClick={toggle}
      className={cn(
        "flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors",
        following ? "border-primary-tint bg-primary-tint text-primary hover:bg-primary-tint-2" : "border-primary text-primary hover:bg-primary-tint-2",
        busy && "cursor-progress opacity-70",
      )}
    >
      <Icon name={following ? "check" : "plus"} size={16} />
      {following ? "Member" : "Join chapter"}
      <span className="sr-only"> {chapter.name}</span>
    </button>
  );
}

/** "Invite people" — copies the chapter link. */
export function InviteButton({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);

  async function invite() {
    const url = `${window.location.origin}/chapters/${slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt("Copy this chapter link", url);
    }
  }

  return (
    <>
      <button type="button" onClick={invite} className={buttonClasses({ variant: "accent" })}>
        {copied ? "Link copied" : "Invite people"}
      </button>
      <span className="sr-only" role="status">
        {copied ? "Chapter link copied to clipboard" : ""}
      </span>
    </>
  );
}

type Session = { key: number } & ComposeStart;

type TeamAction = { kind: "hold" | "remove" | "fraud"; post: PostView };

/**
 * The chapter's Feed tab: a composer that posts into the chapter, the pinned posts and the
 * chapter's latest posts. The chapter's team gets more in each post's menu: pin and unpin (up to
 * three, with who pinned it), send a post back for review, remove it from the chapter, and report
 * it to the platform's moderators as fraud.
 */
export function ChapterFeed({
  chapter,
  viewer,
  initial,
}: {
  chapter: Pick<ChapterDetail, "id" | "slug" | "name" | "pinned" | "pins" | "postApproval"> & { viewer: Pick<ChapterDetail["viewer"], "canManage" | "banned"> };
  viewer: Viewer;
  initial: Page<PostView>;
}) {
  const intl = useIntlTag();
  const t = useT();
  const [pinned, setPinned] = useState<PostView[]>(chapter.pinned);
  const [pins, setPins] = useState<ChapterPin[]>(chapter.pins);
  const [session, setSession] = useState<Session | null>(null);
  const [action, setAction] = useState<TeamAction | null>(null);
  const canManage = chapter.viewer.canManage;
  const pinnedIds = new Set(pinned.map((p) => p.id));
  const blocked = !!blockedReason(intl, t, viewer);
  const reviewed = chapter.postApproval === "review" && !canManage;

  async function setPin(post: PostView, pin: boolean) {
    try {
      const next = await api<ChapterDetail>(pin ? `/chapters/${chapter.slug}/pins` : `/chapters/${chapter.slug}/pins/${post.id}`, {
        method: pin ? "POST" : "DELETE",
        body: pin ? { postId: post.id } : undefined,
      });
      setPinned(next.pinned);
      setPins(next.pins);
      toast.success(pin ? t("Pinned to {chapter}", { chapter: chapter.name }) : t("Unpinned"));
    } catch (e) {
      toast.error(e);
    }
  }

  const extraMenu = (post: PostView): MenuItem[] => {
    if (!canManage || post.chapter?.id !== chapter.id || post.isRepost) return [];
    const items: MenuItem[] = pinnedIds.has(post.id)
      ? [{ label: t("Unpin from chapter"), icon: "pin", onSelect: () => setPin(post, false) }]
      : [
          {
            label: pinned.length >= CHAPTER_PIN_LIMIT ? t("Pin to chapter ({max} max)", { max: CHAPTER_PIN_LIMIT }) : t("Pin to chapter"),
            icon: "pin",
            disabled: pinned.length >= CHAPTER_PIN_LIMIT,
            onSelect: () => setPin(post, true),
          },
        ];
    // The team moderates other members' posts; their own they edit or delete like anyone else.
    if (post.author.id !== viewer.id && post.status === "published" && post.kind !== "announcement") {
      items.push(
        { label: t("Send back for review"), icon: "clock", onSelect: () => setAction({ kind: "hold", post }) },
        { label: t("Remove from chapter"), icon: "x", danger: true, onSelect: () => setAction({ kind: "remove", post }) },
        { label: t("Report fraud"), icon: "flag", danger: true, onSelect: () => setAction({ kind: "fraud", post }) },
      );
    }
    return items;
  };

  async function moderate(kind: "hold" | "remove", post: PostView, note: string) {
    await reviewPost(chapter.slug, post.id, { action: kind, note: note || undefined });
    setPinned((current) => current.filter((p) => p.id !== post.id));
    setPins((current) => current.filter((p) => p.postId !== post.id));
    announcePostRemoved(post.id);
    announceChapterModeration();
    toast.success(kind === "hold" ? t("Sent back for review. It is hidden from the chapter until the team decides.") : t("Removed from {chapter}. The author has been told.", { chapter: chapter.name }));
  }

  async function reportFraud(post: PostView, detail: string) {
    await api(`/chapters/${chapter.slug}/fraud-reports`, { method: "POST", body: { targetType: "post", targetId: post.id, detail } });
    toast.success(t("Reported to the Charter Mission moderators as suspected fraud"));
  }

  function posted(post: PostView) {
    announcePostCreated(post);
    announceDraftsChanged();
    toast.success(
      post.status === "pending_media"
        ? t("Posted. Your files are being checked first.")
        : post.status === "in_review"
          ? t("Sent to the {chapter} team for approval. You’ll be told when it’s live.", { chapter: chapter.name })
          : t("Posted to {chapter}", { chapter: chapter.name }),
    );
  }

  const pinLine = (post: PostView) => {
    const pin = pins.find((p) => p.postId === post.id);
    if (!canManage || !pin) return null;
    return (
      <p className="-mb-1 flex items-center gap-1.5 text-xs text-secondary">
        <Icon name="pin" size={14} />
        {pin.pinnedBy ? t("Pinned by {name}", { name: pin.pinnedBy.id === viewer.id ? t("you") : pin.pinnedBy.name }) : t("Pinned by the chapter team")}
      </p>
    );
  };

  return (
    <>
      <h2 className="sr-only">{t("Chapter feed")}</h2>
      {chapter.viewer.banned ? (
        <div role="note" className="flex items-start gap-2.5 rounded-card border border-line bg-card px-4 py-3 text-sm text-body">
          <Icon name="ban" size={18} className="mt-0.5 shrink-0 text-error" />
          <p>{t("The {chapter} team has removed you from this chapter. You can still read it, but you can’t join it or post here.", { chapter: chapter.name })}</p>
        </div>
      ) : (
        <>
          <Composer viewer={viewer} onOpen={(start) => !blocked && setSession((current) => ({ key: (current?.key ?? 0) + 1, ...start }))} />
          {reviewed && (
            <p className="-mt-2 flex items-center gap-1.5 px-1 text-xs text-secondary">
              <Icon name="shield" size={14} />
              {t("Posts in this chapter are approved by its team before other members see them.")}
            </p>
          )}
        </>
      )}
      {session && (
        <CreatePostDialog
          key={session.key}
          viewer={viewer}
          chapter={{ id: chapter.id, name: chapter.name }}
          initialTool={session.tool}
          initialType={session.type}
          onClose={() => setSession(null)}
          onPosted={posted}
          onDraftChange={announceDraftsChanged}
        />
      )}

      {pinned.length > 0 && (
        <section aria-labelledby="pinned-heading" className="flex flex-col gap-3">
          <h3 id="pinned-heading" className="flex items-center gap-1.5 text-sm font-medium text-secondary">
            <Icon name="pin" size={16} />
            {t("Pinned by the chapter team")}
          </h3>
          {pinned.map((post) => (
            <div key={post.id} className="flex flex-col gap-2">
              {pinLine(post)}
              <PostCard post={post} viewer={viewer} extraMenu={extraMenu} />
            </div>
          ))}
        </section>
      )}

      <PostStream
        path="/feed"
        label={t("{chapter} posts", { chapter: chapter.name })}
        query={{ tab: "latest", chapter: chapter.slug }}
        initial={initial}
        viewer={viewer}
        acceptNew
        acceptCreated={(post) => post.chapter?.id === chapter.id}
        extraMenu={extraMenu}
        empty={
          <EmptyState icon="message" title={t("No posts in this chapter yet")}>
            {t("Start the conversation: share an update, a question or an event idea with {chapter}.", { chapter: chapter.name })}
          </EmptyState>
        }
      />

      {action?.kind === "hold" && (
        <NoteDialog
          title={t("Send this post back for review?")}
          description={t("It is hidden from the chapter and joins the Review tab, where anyone on the team can approve or decline it. {name} is told.", { name: action.post.author.name })}
          label={t("Note for the team and the author (optional)")}
          confirmLabel={t("Send back for review")}
          onConfirm={(note) => moderate("hold", action.post, note)}
          onClose={() => setAction(null)}
        />
      )}
      {action?.kind === "remove" && (
        <NoteDialog
          title={t("Remove this post from the chapter?")}
          description={t("Members will no longer see it. {name} is told, and can still see the post themselves. If it breaks the community guidelines, report it too.", { name: action.post.author.name })}
          label={t("Note for the author (optional)")}
          confirmLabel={t("Remove post")}
          danger
          onConfirm={(note) => moderate("remove", action.post, note)}
          onClose={() => setAction(null)}
        />
      )}
      {action?.kind === "fraud" && (
        <NoteDialog
          title={t("Report this post as fraud?")}
          description={t("It goes to the Charter Mission moderators, marked urgent because it comes from a chapter team. To hide it from the chapter meanwhile, also send it back for review.")}
          label={t("What makes you suspect fraud?")}
          hint={t("At least 10 characters. For example: asks members for money, a fake job offer, a suspicious link.")}
          confirmLabel={t("Report fraud")}
          danger
          required
          maxLength={1000}
          onConfirm={(detail) => reportFraud(action.post, detail)}
          onClose={() => setAction(null)}
        />
      )}
    </>
  );
}

type MemberAction = { kind: "ban" | "fraud"; member: MemberRef };

/**
 * Members tab: everyone who has joined, newest first. The chapter's team can remove a member from
 * the chapter or report one for fraud, and sees who has been removed.
 */
export function ChapterMembers({ slug, name, initial, canManage = false, viewerId, teamIds = [] }: { slug: string; name: string; initial: Page<MemberRef>; canManage?: boolean; viewerId?: string; teamIds?: string[] }) {
  const t = useT();
  const [members, setMembers] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [action, setAction] = useState<MemberAction | null>(null);

  async function more() {
    if (!cursor || loading) return;
    setLoading(true);
    setError(null);
    try {
      const page = await api<Page<MemberRef>>(`/chapters/${slug}/members`, { query: { cursor } });
      setMembers((current) => [...current, ...page.items.filter((m) => !current.some((c) => c.id === m.id))]);
      setCursor(page.nextCursor);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }

  async function ban(member: MemberRef, reason: string) {
    await api(`/chapters/${slug}/bans`, { method: "POST", body: { userId: member.id, reason: reason || undefined } });
    setMembers((current) => current.filter((m) => m.id !== member.id));
    announceChapterModeration();
    toast.success(t("{name} was removed from {chapter}", { name: member.name, chapter: name }));
  }

  async function reportFraud(member: MemberRef, detail: string) {
    await api(`/chapters/${slug}/fraud-reports`, { method: "POST", body: { targetType: "member", targetId: member.id, detail } });
    toast.success(t("Reported to the Charter Mission moderators as suspected fraud"));
  }

  const dialogs = (
    <>
      {action?.kind === "ban" && (
        <NoteDialog
          title={t("Remove {name} from the chapter?", { name: action.member.name })}
          description={t("They leave {chapter} and can’t rejoin or post in it until the team lets them back in. They keep their account and can still read the chapter.", { chapter: name })}
          label={t("Reason (optional, kept for the team)")}
          confirmLabel={t("Remove from chapter")}
          danger
          onConfirm={(reason) => ban(action.member, reason)}
          onClose={() => setAction(null)}
        />
      )}
      {action?.kind === "fraud" && (
        <NoteDialog
          title={t("Report {name} for fraud?", { name: action.member.name })}
          description={t("It goes to the Charter Mission moderators, marked urgent because it comes from a chapter team. Only they can suspend an account.")}
          label={t("What makes you suspect fraud?")}
          hint={t("At least 10 characters. For example: asks members for money, a fake job offer, a suspicious link.")}
          confirmLabel={t("Report fraud")}
          danger
          required
          maxLength={1000}
          onConfirm={(detail) => reportFraud(action.member, detail)}
          onClose={() => setAction(null)}
        />
      )}
    </>
  );

  if (!members.length) {
    return (
      <>
        <EmptyState icon="users" title={t("No members yet")}>
          {t("Be the first to join this chapter.")}
        </EmptyState>
        {canManage && <ChapterBans slug={slug} />}
      </>
    );
  }
  return (
    <>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {members.map((member) => (
          <li key={member.id}>
            <Panel className="flex h-full items-center gap-3 p-4">
              <MemberAvatar member={member} />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <AuthorName member={member} />
                {member.headline && <p className="truncate text-xs text-secondary">{member.headline}</p>}
              </div>
              {canManage && member.id !== viewerId && !member.staff && !teamIds.includes(member.id) && (
                <Menu
                  label={t("Team actions for {name}", { name: member.name })}
                  items={[
                    { label: t("Remove from chapter"), icon: "ban", danger: true, onSelect: () => setAction({ kind: "ban", member }) },
                    { label: t("Report fraud"), icon: "flag", danger: true, onSelect: () => setAction({ kind: "fraud", member }) },
                  ]}
                />
              )}
            </Panel>
          </li>
        ))}
      </ul>
      {error ? <ErrorNotice error={error} onRetry={more} /> : null}
      {cursor && (
        <div className="flex justify-center">
          <Button variant="secondary" onClick={more} aria-disabled={loading}>
            {loading ? t("Loading…") : t("Show more members")}
          </Button>
        </div>
      )}
      {canManage && <ChapterBans slug={slug} />}
      {dialogs}
    </>
  );
}

/** About tab: the text, with an editor for the chapter team. */
export function ChapterAbout({ slug, name, about: initial, canEdit, hashtag }: { slug: string; name: string; hashtag?: string | null; about: string | null; canEdit: boolean }) {
  const [about, setAbout] = useState(initial ?? "");
  const [draft, setDraft] = useState(about);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const next = await api<ChapterDetail>(`/chapters/${slug}`, { method: "PATCH", body: { about: draft } });
      setAbout(next.about ?? "");
      setEditing(false);
      toast.success("About text saved");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel aria-labelledby="about-heading" className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 id="about-heading" className="text-h3 text-ink">
          <T vars={{ name }}>{"About {name}"}</T>
        </h2>
        {canEdit && !editing && (
          <Button
            variant="secondary"
            size="small"
            onClick={() => {
              setDraft(about);
              setEditing(true);
            }}
          >
            Edit
          </Button>
        )}
      </div>
      {editing ? (
        <form onSubmit={save} className="flex flex-col gap-3">
          <label htmlFor="chapter-about" className="sr-only">
            <T vars={{ name }}>{"About {name}"}</T>
          </label>
          <textarea
            id="chapter-about"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={CHAPTER_ABOUT_MAX_CHARS}
            rows={6}
            className="w-full rounded-lg border border-line bg-card px-3 py-2 text-md text-ink focus:border-primary-light focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-light"
          />
          <p className="text-xs text-secondary">
            {draft.length} / {CHAPTER_ABOUT_MAX_CHARS}
          </p>
          {error ? <ErrorNotice error={error} /> : null}
          <div className="flex gap-2">
            <Button type="submit" size="small" aria-disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
            <Button type="button" variant="secondary" size="small" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : about ? (
        <p className="whitespace-pre-line text-md text-body">{about}</p>
      ) : (
        <p className="text-md text-secondary">
          {canEdit ? "Tell members what this chapter is about, where it meets and how to get involved." : "The chapter team hasn’t added a description yet."}
        </p>
      )}
      {hashtag && !editing && (
        <p className="flex flex-wrap items-center gap-2 border-t border-line pt-3 text-sm text-secondary">
          Chapter hashtag
          <Link href={topicHref(hashtag)}>
            <Chip tone="hashtag" className="hover:bg-accent hover:text-inverse">
              #{hashtag}
            </Chip>
          </Link>
          <span>Add it to a post so members of this chapter can find it.</span>
        </p>
      )}
    </Panel>
  );
}
