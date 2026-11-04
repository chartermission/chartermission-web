"use client";

/** What a "write a post" call to action asks the feed composer to open with. */
export type ComposeRequest = { body?: string };

type Listener = (request: ComposeRequest) => void;
const listeners = new Set<Listener>();

/** Ask the feed composer (feed-composer.tsx) to open the create-post dialog. Returns false when no composer is listening. */
export function requestCompose(request: ComposeRequest = {}): boolean {
  listeners.forEach((listener) => listener(request));
  return listeners.size > 0;
}

export function onComposeRequest(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
