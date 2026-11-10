"use client";

import { useSyncExternalStore } from "react";
import type { Translate } from "@/i18n/translate";
import { useT, useIntlTag } from "@/i18n/client";

const noSubscribe = () => () => {};

function format(intl: string, iso: string, timeZone?: string) {
  const date = new Date(iso);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat(intl, {
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

function ago(intl: string, t: Translate, iso: string, now: number, timeZone?: string) {
  const diff = Math.max(0, now - new Date(iso).getTime());
  if (diff < MINUTE) return "just now";
  if (diff < HOUR) return t("{count} min ago", { count: Math.floor(diff / MINUTE) });
  if (diff < DAY) return t("{count} h ago", { count: Math.floor(diff / HOUR) });
  if (diff < 7 * DAY) {
    const days = Math.floor(diff / DAY);
    return days === 1 ? "yesterday" : t("{count} days ago", { count: days });
  }
  return `on ${new Date(iso).toLocaleDateString(intl, { day: "numeric", month: "short", year: "numeric", timeZone })}`;
}

/**
 * A date-time in the member's own time zone ("Thu 5 Nov, 15:55 GST"). The server doesn't know
 * the browser's zone, so it renders UTC and the client swaps in local time after hydration.
 */
export function LocalDateTime({ iso, className }: { iso: string; className?: string }) {
  const intl = useIntlTag();
  const text = useSyncExternalStore(
    noSubscribe,
    () => format(intl, iso),
    () => format(intl, iso, "UTC"),
  );
  return (
    <time dateTime={iso} className={className}>
      {text}
    </time>
  );
}

/** "Edited 2 h ago" style relative time, local-zone date for older ones. */
export function TimeAgo({ iso, prefix, className }: { iso: string; prefix: string; className?: string }) {
  const intl = useIntlTag();
  const t = useT();
  const text = useSyncExternalStore(
    noSubscribe,
    () => ago(intl, t, iso, Date.now()),
    () => ago(intl, t, iso, Date.now(), "UTC"),
  );
  return (
    <time dateTime={iso} className={className}>
      {prefix} {text}
    </time>
  );
}
