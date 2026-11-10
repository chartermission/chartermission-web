"use client";

import type { PostView } from "@chartermission/contracts";

/** Tiny pub-sub so a post created in the composer (or a repost) can appear at the top of open lists. */
type Listener = (post: PostView) => void;
const listeners = new Set<Listener>();

export function onPostCreated(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function announcePostCreated(post: PostView) {
  listeners.forEach((listener) => listener(post));
}

/** The same for a post taken out of view (held or removed by a chapter's team): open lists drop it. */
type RemovedListener = (postId: string) => void;
const removedListeners = new Set<RemovedListener>();

export function onPostRemoved(listener: RemovedListener) {
  removedListeners.add(listener);
  return () => {
    removedListeners.delete(listener);
  };
}

export function announcePostRemoved(postId: string) {
  removedListeners.forEach((listener) => listener(postId));
}
