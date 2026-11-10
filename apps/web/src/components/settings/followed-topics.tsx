"use client";

import Link from "next/link";
import { useState, type KeyboardEvent } from "react";
import type { FollowView, Page } from "@chartermission/contracts";
import { Button, Icon, chipClasses, cn } from "@chartermission/ui";
import { api, isApiError } from "@/lib/api/client";
import { VerifyPrompt, RestrictedPrompt } from "@/components/account/verify-prompt";
import { SettingsCard } from "./settings-card";

const TAG = /^[A-Za-z0-9_]{2,50}$/;

type Topic = { id: string; display: string };

const toTopic = (follow: FollowView): Topic => ({ id: follow.targetId, display: follow.hashtag?.display ?? follow.targetId });

/** Followed hashtags — target of the feed rail's "Manage" link (/settings#topics). */
export function FollowedTopics({ initial }: { initial: Page<FollowView> }) {
  const [topics, setTopics] = useState<Topic[]>(initial.items.map(toTopic));
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<{ kind: "verify" } | { kind: "restricted"; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  async function follow() {
    const tag = draft.trim().replace(/^#/, "");
    if (!TAG.test(tag)) {
      setError("Use 2–50 letters, numbers or underscores, without spaces.");
      return;
    }
    if (topics.some((topic) => topic.id === tag.toLowerCase())) {
      setError(`You already follow #${tag}.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api("/follows", { method: "POST", body: { targetType: "hashtag", targetId: tag } });
      setTopics((prev) => [{ id: tag.toLowerCase(), display: tag }, ...prev]);
      setDraft("");
      setStatus(`You now follow #${tag}.`);
    } catch (e) {
      if (isApiError(e, "EMAIL_NOT_VERIFIED")) setBlocked({ kind: "verify" });
      else if (isApiError(e, "ACCOUNT_RESTRICTED") || isApiError(e, "ACCOUNT_SUSPENDED"))
        setBlocked({ kind: "restricted", message: e.message });
      else setError(isApiError(e) ? (e.fields?.targetId ?? e.message) : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function unfollow(topic: Topic) {
    const previous = topics;
    setTopics((prev) => prev.filter((item) => item.id !== topic.id));
    try {
      await api("/follows", { method: "DELETE", body: { targetType: "hashtag", targetId: topic.id } });
      setStatus(`You unfollowed #${topic.display}.`);
    } catch (e) {
      setTopics(previous);
      setError(isApiError(e) ? e.message : "Something went wrong. Please try again.");
    }
  }

  async function loadMore() {
    if (!cursor) return;
    try {
      const page = await api<Page<FollowView>>("/me/follows", { query: { type: "hashtag", limit: 50, cursor } });
      setTopics((prev) => [...prev, ...page.items.map(toTopic)]);
      setCursor(page.nextCursor);
    } catch (e) {
      setError(isApiError(e) ? e.message : "Something went wrong. Please try again.");
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      void follow();
    }
  }

  return (
    <SettingsCard id="topics" title="Topics you follow" description="Hashtags shape your feed and your trending-topic alerts.">
      <li className="flex flex-col gap-3 py-3.5">
        {topics.length > 0 ? (
          <ul className="flex flex-wrap gap-2" aria-label="Followed hashtags">
            {topics.map((topic) => (
              <li key={topic.id} className={chipClasses("hashtag", "gap-1 pe-1.5")}>
                <Link href={`/topics/${encodeURIComponent(topic.id)}`} className="hover:underline">
                  #{topic.display}
                </Link>
                <button
                  type="button"
                  onClick={() => void unfollow(topic)}
                  aria-label={`Unfollow #${topic.display}`}
                  className="rounded-full p-0.5 hover:bg-accent/15 focus-visible:outline-2 focus-visible:outline-primary-light"
                >
                  <Icon name="x" size={14} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-secondary">You don’t follow any hashtags yet. Follow a few to fill your feed.</p>
        )}
        {cursor && (
          <Button variant="ghost" size="small" className="self-start" onClick={() => void loadMore()}>
            Show more
          </Button>
        )}
      </li>
      <li className="flex flex-col gap-1.5 py-3.5">
        <label htmlFor="add-topic" className="text-sm font-medium text-ink">
          Follow a hashtag
        </label>
        <div className="flex gap-2">
          <span className="relative flex w-[280px] max-w-full">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 start-3 -translate-y-1/2 text-sm text-secondary"
            >
              #
            </span>
            <input
              id="add-topic"
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setError(null);
              }}
              onKeyDown={onKeyDown}
              placeholder="e.g. CleanEnergy"
              autoComplete="off"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "add-topic-error" : undefined}
              className={cn(
                "w-full rounded-lg border bg-card py-2 pe-3 ps-7 text-sm text-ink placeholder:text-disabled hover:border-line-strong focus:border-primary-light focus:outline-none",
                error ? "border-error" : "border-line",
              )}
            />
          </span>
          <Button variant="secondary" size="small" onClick={() => void follow()} disabled={busy}>
            {busy ? "Following…" : "Follow"}
          </Button>
        </div>
        {error && (
          <p id="add-topic-error" className="text-xs text-error">
            {error}
          </p>
        )}
        {blocked?.kind === "verify" && <VerifyPrompt action="follow hashtags" className="mt-2" />}
        {blocked?.kind === "restricted" && <RestrictedPrompt message={blocked.message} className="mt-2" />}
        <p role="status" className="sr-only">
          {status}
        </p>
      </li>
    </SettingsCard>
  );
}
