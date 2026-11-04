"use client";

import { useSyncExternalStore } from "react";

/*
 * "Hide for today" for the welcome nudge and the moment cards: { [id]: local YYYY-MM-DD }
 * in localStorage. Entries from earlier days are dropped on the next write. Storage can be
 * unavailable (private mode, quota, disabled): every access is wrapped and fails open.
 */
const KEY = "cm:home:hidden";
const listeners = new Set<() => void>();

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function read(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function write(change: (current: Record<string, string>) => Record<string, string>) {
  const day = today();
  const kept = Object.fromEntries(Object.entries(read()).filter(([, value]) => value === day));
  try {
    window.localStorage.setItem(KEY, JSON.stringify(change(kept)));
  } catch {
    // Not remembered across reloads; the in-page state below still hides it.
  }
  listeners.forEach((listener) => listener());
}

/** Session fallback when storage writes fail, so "hide" still works on this page. */
const session = new Map<string, boolean>();

export function hideForToday(id: string) {
  session.set(id, true);
  write((current) => ({ ...current, [id]: today() }));
}

export function unhide(id: string) {
  session.set(id, false);
  write((current) => {
    const next = { ...current };
    delete next[id];
    return next;
  });
}

function isHidden(id: string) {
  return session.get(id) ?? read()[id] === today();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => event.key === KEY && listener();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Whether `id` was hidden today; null while rendering on the server / hydrating (unknown, so render nothing). */
export function useHiddenToday(id: string): boolean | null {
  return useSyncExternalStore(
    subscribe,
    () => isHidden(id),
    () => null,
  );
}
