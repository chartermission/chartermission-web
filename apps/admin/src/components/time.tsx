"use client";

import { useSyncExternalStore } from "react";
import { formatDate, formatDateTime, relativeAge, relativePhrase } from "@/lib/format";

const TICK_MS = 30_000;

function subscribe(onChange: () => void) {
  const id = window.setInterval(onChange, TICK_MS);
  return () => window.clearInterval(id);
}
const getNow = () => Math.floor(Date.now() / TICK_MS) * TICK_MS;
const getServerNow = () => null;

/**
 * The current time, ticking every 30 s in the browser. Null while server rendering, so the
 * server HTML never depends on the clock and hydration always matches.
 */
export function useNow(): number | null {
  return useSyncExternalStore(subscribe, getNow, getServerNow);
}

/**
 * Absolute date and time in the admin's own time zone, e.g. "3 Nov 2026, 14:05".
 * The server render uses UTC; the browser switches to local time after hydration.
 */
export function DateTime({ iso, dateOnly = false, className }: { iso: string; dateOnly?: boolean; className?: string }) {
  const now = useNow();
  const zone = now === null ? "UTC" : undefined;
  const text = dateOnly ? formatDate(iso, zone) : formatDateTime(iso, zone);
  return (
    <time dateTime={iso} className={className} title={formatDateTime(iso, zone)}>
      {text}
    </time>
  );
}

/** Compact age ("12m", "3h", "2d") with the absolute time as a tooltip. */
export function Age({ iso, className }: { iso: string; className?: string }) {
  const now = useNow();
  return (
    <time dateTime={iso} className={className} title={formatDateTime(iso, now === null ? "UTC" : undefined)}>
      {now === null ? formatDate(iso, "UTC") : relativeAge(iso, now)}
    </time>
  );
}

/** "2 min ago" / "in 3 days". */
export function Relative({ iso, className }: { iso: string; className?: string }) {
  const now = useNow();
  return (
    <time dateTime={iso} className={className} title={formatDateTime(iso, now === null ? "UTC" : undefined)}>
      {now === null ? formatDateTime(iso, "UTC") : relativePhrase(iso, now)}
    </time>
  );
}
