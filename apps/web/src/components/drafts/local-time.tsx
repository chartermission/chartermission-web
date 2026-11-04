"use client";

import { useSyncExternalStore } from "react";

const noSubscribe = () => () => {};

function format(iso: string, timeZone?: string) {
  const date = new Date(iso);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: sameYear ? undefined : "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone,
  }).format(date);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function ago(iso: string, now: number, timeZone?: string) {
  const diff = Math.max(0, now - new Date(iso).getTime());
  if (diff < MINUTE) return "just now";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} min ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} h ago`;
  if (diff < 7 * DAY) {
    const days = Math.floor(diff / DAY);
    return days === 1 ? "yesterday" : `${days} days ago`;
  }
  return `on ${new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone })}`;
}

/**
 * A date-time in the member's own time zone ("Thu 5 Nov, 15:55 GST"). The server doesn't know
 * the browser's zone, so it renders UTC and the client swaps in local time after hydration.
 */
export function LocalDateTime({ iso, className }: { iso: string; className?: string }) {
  const text = useSyncExternalStore(
    noSubscribe,
    () => format(iso),
    () => format(iso, "UTC"),
  );
  return (
    <time dateTime={iso} className={className}>
      {text}
    </time>
  );
}

/** "Edited 2 h ago" style relative time, local-zone date for older ones. */
export function TimeAgo({ iso, prefix, className }: { iso: string; prefix: string; className?: string }) {
  const text = useSyncExternalStore(
    noSubscribe,
    () => ago(iso, Date.now()),
    () => ago(iso, Date.now(), "UTC"),
  );
  return (
    <time dateTime={iso} className={className}>
      {prefix} {text}
    </time>
  );
}
