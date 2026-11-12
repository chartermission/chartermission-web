"use client";

import type { MessageStreamEvent } from "@chartermission/contracts";

/*
 * One live connection per tab (GET /messages/stream, Server-Sent Events), shared by everything
 * that wants message events: the nav badge, the conversation list and the open conversation. The
 * browser reconnects by itself; listeners also hear "reconnected" so they can catch up on anything
 * missed while the connection was down.
 */

type Listener = (event: MessageStreamEvent | { type: "reconnected" }) => void;

const listeners = new Set<Listener>();
let source: EventSource | null = null;
let wasOpen = false;
let closeTimer: number | null = null;

function open() {
  if (source || typeof window === "undefined" || !("EventSource" in window)) return;
  source = new EventSource("/api/v1/messages/stream", { withCredentials: true });
  source.addEventListener("open", () => {
    if (wasOpen) for (const l of listeners) l({ type: "reconnected" });
    wasOpen = true;
  });
  source.addEventListener("message", (raw) => {
    let event: MessageStreamEvent;
    try {
      event = JSON.parse((raw as MessageEvent<string>).data) as MessageStreamEvent;
    } catch {
      return;
    }
    for (const l of listeners) l(event);
  });
}

/** Listen to live message events; returns the function that stops listening. */
export function subscribeMessages(listener: Listener): () => void {
  if (closeTimer !== null) {
    window.clearTimeout(closeTimer);
    closeTimer = null;
  }
  listeners.add(listener);
  open();
  return () => {
    listeners.delete(listener);
    // Keep the connection briefly in case another component is about to listen (page changes).
    if (!listeners.size) {
      closeTimer = window.setTimeout(() => {
        if (listeners.size) return;
        source?.close();
        source = null;
        wasOpen = false;
      }, 5000);
    }
  };
}

/** Whether live updates are available in this browser (else components fall back to polling). */
export const liveSupported = () => typeof window !== "undefined" && "EventSource" in window;
