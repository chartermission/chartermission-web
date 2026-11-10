"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  CHAPTER_ABOUT_MAX_CHARS,
  CHAPTER_PIN_LIMIT,
  type ChapterDetail,
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
import { toast } from "@/components/social/toast";
import type { Viewer } from "@/components/social/viewer";
import { api } from "@/lib/api/client";

/** "Join" / "Joined" on the dark chapter header (joining is following the chapter). */
export function JoinChapterButton({ chapter, following: initial }: { chapter: Pick<ChapterDetail, "id" | "name">; following: boolean }) {
  const router = useRouter();
  const [following, setFollowing] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    const next = !following;
    setBusy(true);
    setFollowing(next);
    try {
      await api("/follows", { method: next ? "POST" : "DELETE", body: { targetType: "chapter", targetId: chapter.id } });
      toast.success(next ? `You joined ${chapter.name}` : `You left ${chapter.name}`);
      router.refresh();
    } catch (e) {
      setFollowing(!next);
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      aria-pressed={following}
      aria-disabled={busy}
      onClick={toggle}
      className={cn(
        "flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium text-inverse transition-colors",
        following ? "bg-white/12 hover:bg-white/20" : "border border-white/40 hover:bg-white/12",
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

/**
 * The chapter's Feed tab: a composer that posts into the chapter, the pinned posts and the
 * chapter's latest posts. Ambassadors pin and unpin from each post's menu (up to three).
 */
export function ChapterFeed({
  chapter,
  viewer,
  initial,
}: {
  chapter: Pick<ChapterDetail, "id" | "slug" | "name" | "pinned"> & { viewer: Pick<ChapterDetail["viewer"], "canManage"> };
  viewer: Viewer;
  initial: Page<PostView>;
}) {
  const [pinned, setPinned] = useState<PostView[]>(chapter.pinned);
  const [session, setSession] = useState<Session | null>(null);
  const canManage = chapter.viewer.canManage;
  const pinnedIds = new Set(pinned.map((p) => p.id));
  const blocked = !!blockedReason(viewer);

  async function setPin(post: PostView, pin: boolean) {
    try {
      const next = await api<ChapterDetail>(pin ? `/chapters/${chapter.slug}/pins` : `/chapters/${chapter.slug}/pins/${post.id}`, {
        method: pin ? "POST" : "DELETE",
        body: pin ? { postId: post.id } : undefined,
      });
      setPinned(next.pinned);
      toast.success(pin ? `Pinned to ${chapter.name}` : "Unpinned");
    } catch (e) {
      toast.error(e);
    }
  }

  const extraMenu = (post: PostView): MenuItem[] => {
    if (!canManage || post.chapter?.id !== chapter.id || post.isRepost) return [];
    if (pinnedIds.has(post.id)) return [{ label: "Unpin from chapter", icon: "pin", onSelect: () => setPin(post, false) }];
    return [
      {
        label: pinned.length >= CHAPTER_PIN_LIMIT ? `Pin to chapter (${CHAPTER_PIN_LIMIT} max)` : "Pin to chapter",
        icon: "pin",
        disabled: pinned.length >= CHAPTER_PIN_LIMIT,
        onSelect: () => setPin(post, true),
      },
    ];
  };

  function posted(post: PostView) {
    announcePostCreated(post);
    announceDraftsChanged();
    toast.success(post.status === "pending_media" ? "Posted. Your files are being checked first." : `Posted to ${chapter.name}`);
  }

  return (
    <>
      <h2 className="sr-only">Chapter feed</h2>
      <Composer viewer={viewer} onOpen={(start) => !blocked && setSession((current) => ({ key: (current?.key ?? 0) + 1, ...start }))} />
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
            Pinned by the chapter team
          </h3>
          {pinned.map((post) => (
            <PostCard key={post.id} post={post} viewer={viewer} extraMenu={extraMenu} />
          ))}
        </section>
      )}

      <PostStream
        path="/feed"
        label={`${chapter.name} posts`}
        query={{ tab: "latest", chapter: chapter.slug }}
        initial={initial}
        viewer={viewer}
        acceptNew
        acceptCreated={(post) => post.chapter?.id === chapter.id}
        extraMenu={extraMenu}
        empty={
          <EmptyState icon="message" title="No posts in this chapter yet">
            Start the conversation: share an update, a question or an event idea with {chapter.name}.
          </EmptyState>
        }
      />
    </>
  );
}

/** Members tab: everyone who has joined, newest first. */
export function ChapterMembers({ slug, initial }: { slug: string; initial: Page<MemberRef> }) {
  const [members, setMembers] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

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

  if (!members.length) {
    return (
      <EmptyState icon="users" title="No members yet">
        Be the first to join this chapter.
      </EmptyState>
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
            </Panel>
          </li>
        ))}
      </ul>
      {error ? <ErrorNotice error={error} onRetry={more} /> : null}
      {cursor && (
        <div className="flex justify-center">
          <Button variant="secondary" onClick={more} aria-disabled={loading}>
            {loading ? "Loading…" : "Show more members"}
          </Button>
        </div>
      )}
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
          About {name}
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
            About {name}
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
