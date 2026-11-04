"use client";

import { useSyncExternalStore } from "react";

/** Part of the day on the viewer's device, in local time. */
export type DayPeriod = "morning" | "afternoon" | "evening" | "night";

export function dayPeriod(date = new Date()): DayPeriod {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

export const greetingFor: Record<DayPeriod, string> = {
  morning: "Good morning",
  afternoon: "Good afternoon",
  evening: "Good evening",
  night: "Good evening",
};

// The period only matters at render time; re-check when the tab comes back into view.
function subscribe(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

/** The local part of the day, or null on the server and during hydration (the server can't know the viewer's clock). */
export function useDayPeriod(): DayPeriod | null {
  return useSyncExternalStore<DayPeriod | null>(subscribe, () => dayPeriod(), () => null);
}
