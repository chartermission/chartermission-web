"use client";

/**
 * Tiny pub-sub so the feed's "Drafts (n) / Scheduled (n)" links refresh when a draft is
 * saved, scheduled, published or deleted elsewhere on the page (composer, drafts page).
 */
const listeners = new Set<() => void>();

export function onDraftsChanged(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function announceDraftsChanged() {
  listeners.forEach((listener) => listener());
}
