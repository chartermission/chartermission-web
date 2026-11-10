"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { usePathname, useT } from "@/i18n/client";
import { createContext, useCallback, useContext, useMemo, useState, useTransition, type ReactNode } from "react";
import type { TopicSummary } from "@chartermission/contracts";
import { Icon, buttonClasses, cn } from "@chartermission/ui";
import { api } from "@/lib/api/client";
import { toast } from "@/components/social/toast";

/* ---------- URL state ---------- */

/** Update the explore page's search params (defaults removed) inside a transition. */
export function useExploreNav() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const go = useCallback(
    (updates: Record<string, string | null>, mode: "push" | "replace" = "push") => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      const qs = next.toString();
      startTransition(() => {
        router[mode](qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      });
    },
    [params, pathname, router],
  );

  const refresh = useCallback(() => startTransition(() => router.refresh()), [router]);

  return { go, refresh, pending };
}

/* ---------- Follow state shared by every list on the page ---------- */

type Entry = { following: boolean; summary: TopicSummary };
type Store = {
  entries: Record<string, Entry>;
  set: (summary: TopicSummary, following: boolean) => void;
};

const FollowContext = createContext<Store | null>(null);

/**
 * Keeps follow toggles in sync across Trending, Your topics, Popular / New and search results,
 * and lets "Your topics" pick up topics followed elsewhere on the page.
 */
export function FollowProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const set = useCallback((summary: TopicSummary, following: boolean) => {
    setEntries((prev) => ({ ...prev, [summary.tag.toLowerCase()]: { following, summary } }));
  }, []);
  const value = useMemo(() => ({ entries, set }), [entries, set]);
  return <FollowContext.Provider value={value}>{children}</FollowContext.Provider>;
}

function useStore(): Store {
  const store = useContext(FollowContext);
  if (!store) throw new Error("FollowProvider missing");
  return store;
}

/** Topics followed on this page since it loaded (newest first), for "Your topics". */
export function useSessionFollowed(): TopicSummary[] {
  const { entries } = useStore();
  return Object.values(entries)
    .filter((entry) => entry.following)
    .map((entry) => entry.summary)
    .reverse();
}

/** A topic's live follow state and follower count, with an optimistic toggle. */
export function useTopicFollow(topic: TopicSummary) {
  const t = useT();
  const { entries, set } = useStore();
  const [busy, setBusy] = useState(false);
  const entry = entries[topic.tag.toLowerCase()];
  const following = entry ? entry.following : topic.following;
  const followers = Math.max(0, topic.followers + (following === topic.following ? 0 : following ? 1 : -1));

  async function toggle() {
    const next = !following;
    setBusy(true);
    set(topic, next);
    try {
      await api("/follows", { method: next ? "POST" : "DELETE", body: { targetType: "hashtag", targetId: topic.tag.toLowerCase() } });
      toast.success(next ? t("Following #{tag}. Its posts will show up in your feed.", { tag: topic.tag }) : t("Unfollowed #{tag}", { tag: topic.tag }));
    } catch (e) {
      set(topic, !next);
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }

  return { following, followers, busy, toggle };
}

/** Follow / Following toggle (aria-pressed); the tag is in the accessible name. */
export function FollowButton({
  following,
  busy,
  onToggle,
  tag,
  className,
}: {
  following: boolean;
  busy: boolean;
  onToggle: () => void;
  tag: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={following}
      disabled={busy}
      onClick={onToggle}
      className={cn(
        following
          ? "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-transparent bg-primary-tint px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary-tint-2 hover:border-line-strong disabled:opacity-60"
          : buttonClasses({ variant: "secondary", size: "small", className: "gap-1.5" }),
        className,
      )}
    >
      <Icon name={following ? "check" : "plus"} size={15} />
      {following ? "Following" : "Follow"}
      <span className="sr-only"> #{tag}</span>
    </button>
  );
}
