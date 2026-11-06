"use client";

import { useSyncExternalStore } from "react";

const noSubscribe = () => () => {};
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const serverZone = () => null;

/**
 * The browser's IANA zone, or null during server rendering and hydration's first pass (the
 * server can't know it). Components render the event's own zone until it's known.
 */
export function useViewerZone(): string | null {
  return useSyncExternalStore(noSubscribe, browserZone, serverZone);
}

const minuteNow = () => Math.floor(Date.now() / 60_000) * 60_000;

/** The current time to the minute, stable within a render pass (for "has it started?" checks). */
export function useNow(): number {
  return useSyncExternalStore(noSubscribe, minuteNow, minuteNow);
}
