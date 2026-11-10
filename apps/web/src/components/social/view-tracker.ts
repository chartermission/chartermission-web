"use client";

import { useEffect, type RefObject } from "react";

/*
 * Post views for analytics. A post counts as seen once at least half of it has been on screen for
 * a second. Ids are sent in small batches to POST /posts/views; the API stores them against a
 * keyed hash of the member, ignores the author's own views and counts a member again only after
 * 30 minutes. Nothing here is essential: failures are dropped silently.
 */

const VISIBLE_MS = 1000;
const FLUSH_MS = 2500;
const BATCH = 25;

const queue = new Set<string>();
/** Sent during this page view, so scrolling back up doesn't re-send. */
const sent = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;
let listening = false;

function flush() {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!queue.size) return;
  const postIds = [...queue].slice(0, BATCH);
  for (const id of postIds) queue.delete(id);
  // keepalive lets the last batch finish while the page is being left.
  void fetch("/api/v1/posts/views", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", "x-cm-csrf": "1" },
    body: JSON.stringify({ postIds }),
    credentials: "same-origin",
    keepalive: true,
  }).catch(() => {});
  if (queue.size) timer = setTimeout(flush, FLUSH_MS);
}

function record(id: string) {
  if (sent.has(id)) return;
  sent.add(id);
  queue.add(id);
  if (!listening) {
    listening = true;
    document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush());
    window.addEventListener("pagehide", flush);
  }
  if (queue.size >= BATCH) flush();
  else timer ??= setTimeout(flush, FLUSH_MS);
}

/** Reports the post as seen once half of `ref` has been visible for a second. Pass `enabled: false` for the viewer's own posts. */
export function usePostView(ref: RefObject<Element | null>, postId: string, enabled = true) {
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el || sent.has(postId) || typeof IntersectionObserver === "undefined") return;
    let dwell: ReturnType<typeof setTimeout> | null = null;
    const observer = new IntersectionObserver(
      ([entry]) => {
        // Tall posts never show 50% at once on a phone: a screenful of the post counts too.
        const seen = !!entry && entry.isIntersecting && (entry.intersectionRatio >= 0.5 || entry.intersectionRect.height >= window.innerHeight * 0.6);
        if (seen && !dwell) {
          dwell = setTimeout(() => {
            record(postId);
            observer.disconnect();
          }, VISIBLE_MS);
        } else if (!seen && dwell) {
          clearTimeout(dwell);
          dwell = null;
        }
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    observer.observe(el);
    return () => {
      if (dwell) clearTimeout(dwell);
      observer.disconnect();
    };
  }, [ref, postId, enabled]);
}
