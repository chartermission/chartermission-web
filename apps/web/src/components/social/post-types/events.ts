"use client";

import type { PostView } from "@chartermission/contracts";

/**
 * Lets the answers list on a question's page tell the post card above it that the
 * best answer changed (both render from separate client trees).
 */
type Listener = (postId: string, question: NonNullable<PostView["question"]>) => void;
const listeners = new Set<Listener>();

export function onQuestionChange(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function announceQuestionChange(postId: string, question: NonNullable<PostView["question"]>) {
  listeners.forEach((listener) => listener(postId, question));
}
