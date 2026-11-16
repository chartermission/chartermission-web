"use client";

/**
 * "Show me the new posts" requests from outside the feed list (the welcome strip's
 * "N new posts since your last visit"). The Latest feed's PostStream listens and shows them
 * in place; when nothing listens the caller navigates to /feed?tab=latest&since=… instead.
 */
type Listener = (since: string) => void;
const listeners = new Set<Listener>();

/** Ask the open feed list to show posts newer than `since`. Returns false when no list is listening. */
export function requestNewPosts(since: string): boolean {
  listeners.forEach((listener) => listener(since));
  return listeners.size > 0;
}

export function onNewPostsRequest(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
