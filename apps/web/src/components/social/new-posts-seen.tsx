"use client";

import { useEffect } from "react";
import { absoluteDateTime, relativeTime } from "./format";
import { useIntlTag, useT } from "@/i18n/client";

/** When the member last opened the new posts (sessionStorage): the feed's pill counts from then. */
const SEEN_KEY = "cm:new-posts-seen-at";

export function newPostsSeenAt(): string | null {
  try {
    return sessionStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

/** Marks the new posts as seen when /feed/latest opens. */
export function NewPostsSeen() {
  useEffect(() => {
    try {
      sessionStorage.setItem(SEEN_KEY, new Date().toISOString());
    } catch {
      // Private mode: the pill just counts from the newest post shown.
    }
  }, []);
  return null;
}

/** "Posted since 2 hours ago" under the heading, with the exact time on hover. */
export function NewPostsSince({ since }: { since: string }) {
  const t = useT();
  const intl = useIntlTag();
  return (
    <p className="text-sm text-secondary" title={absoluteDateTime(intl, since)} suppressHydrationWarning>
      {t("Posted since {time}", { time: relativeTime(intl, t, since) })}
    </p>
  );
}
