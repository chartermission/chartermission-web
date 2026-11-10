"use client";

/** Fired when the number of unread conversations may have changed, so the nav badge refreshes. */
const CHANGED = "cm:messages-changed";
export const announceMessagesChanged = () => window.dispatchEvent(new Event(CHANGED));
export function onMessagesChanged(run: () => void) {
  window.addEventListener(CHANGED, run);
  return () => window.removeEventListener(CHANGED, run);
}
