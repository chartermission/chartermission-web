"use client";

import { useCallback, useState } from "react";
import type { MemberRef, StoryTray } from "@chartermission/contracts";
import { Avatar, Icon, Panel } from "@chartermission/ui";
import { api } from "@/lib/api/client";
import { StoryComposer } from "./story-composer";
import { StoryRing, storyRingSize } from "./story-ring";
import { StoryViewer, type StoryGroup } from "./story-viewer";

type Me = Pick<MemberRef, "id" | "name" | "avatarUrl" | "tone">;

/**
 * Stories strip at the top of the home feed: "Your story" first, then the people you are connected
 * to or follow, unseen first. Opens the full-screen viewer or the story composer.
 */
export function StoriesStrip({ initial, me, canPost }: { initial: StoryTray; me: Me; canPost: boolean }) {
  const [tray, setTray] = useState(initial);
  const [open, setOpen] = useState<number | null>(null);
  const [composing, setComposing] = useState(false);

  const groups: StoryGroup[] = [
    ...(tray.mine ? [{ key: "mine", author: tray.mine.author, stories: tray.mine.stories }] : []),
    ...tray.items.map((item) => ({ key: item.author.id, author: item.author, stories: item.stories })),
  ];
  const offset = tray.mine ? 1 : 0;

  const refresh = useCallback(() => {
    api<StoryTray>("/stories/tray")
      .then(setTray)
      .catch(() => undefined);
  }, []);

  const markSeen = useCallback((storyId: string) => {
    setTray((t) => ({
      ...t,
      items: t.items.map((item) => {
        const stories = item.stories.map((s) => (s.id === storyId ? { ...s, viewer: { ...s.viewer, seen: true } } : s));
        return { ...item, stories, hasUnseen: stories.some((s) => !s.viewer.seen) };
      }),
    }));
  }, []);

  return (
    <Panel aria-label="Stories" className="p-3">
      <ul className="flex gap-3 overflow-x-auto pb-1 [scrollbar-width:thin]">
        <li className="flex w-[72px] shrink-0 flex-col items-center gap-1">
          <span className="relative flex">
            {tray.mine ? (
              <button type="button" onClick={() => setOpen(0)} className="flex rounded-full focus-visible:outline-2 focus-visible:outline-primary-light" aria-label="View your story">
                <StoryRing member={me} unseen={false} />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => canPost && setComposing(true)}
                disabled={!canPost}
                className="flex items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-primary-light disabled:opacity-60"
                style={{ width: storyRingSize(56), height: storyRingSize(56) }}
                aria-label="Add to your story"
              >
                <Avatar name={me.name} src={me.avatarUrl ?? undefined} tone={me.tone} size={56} />
              </button>
            )}
            {canPost && (
              <button
                type="button"
                onClick={() => setComposing(true)}
                className="absolute -bottom-0.5 -right-0.5 flex size-6 items-center justify-center rounded-full border-2 border-card bg-primary text-inverse hover:bg-primary-light"
                aria-label="Add to your story"
                tabIndex={tray.mine ? 0 : -1}
              >
                <Icon name="plus" size={14} />
              </button>
            )}
          </span>
          <span className="w-full truncate text-center text-xs text-body">Your story</span>
        </li>
        {tray.items.map((item, index) => (
          <li key={item.author.id} className="flex w-[72px] shrink-0 flex-col items-center gap-1">
            <button
              type="button"
              onClick={() => setOpen(index + offset)}
              className="flex rounded-full focus-visible:outline-2 focus-visible:outline-primary-light"
              aria-label={`View ${item.author.name}’s story${item.hasUnseen ? " (new)" : ""}`}
            >
              <StoryRing member={item.author} unseen={item.hasUnseen} />
            </button>
            <span className="w-full truncate text-center text-xs text-body" aria-hidden="true">
              {item.author.name.split(" ")[0]}
            </span>
          </li>
        ))}
        {tray.items.length === 0 && !tray.mine && (
          <li className="flex min-w-0 items-center text-sm text-secondary">
            Share a photo or short video with your connections for 24 hours. Stories from people you follow show up here.
          </li>
        )}
      </ul>
      {open !== null && groups.length > 0 && (
        <StoryViewer
          groups={groups}
          startGroup={open}
          onClose={() => {
            setOpen(null);
            refresh();
          }}
          onSeen={markSeen}
        />
      )}
      {composing && <StoryComposer onClose={() => setComposing(false)} onPosted={refresh} />}
    </Panel>
  );
}
