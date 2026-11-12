"use client";

/*
 * Messages typed while offline (or whose send failed) wait here, per conversation, and are sent
 * again when the connection returns. Each carries the clientId the server de-duplicates on, so a
 * message that did arrive before the connection dropped is never stored twice.
 */

export type OutboxItem = {
  clientId: string;
  conversationId: string;
  body: string;
  replyToId?: string;
  createdAt: string;
  /** "sending" while a request is in flight; "waiting" for the connection; "failed" after the server refused it. */
  state: "sending" | "waiting" | "failed";
  error?: string;
};

const KEY = "cm:outbox";

function read(): OutboxItem[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as OutboxItem[]) : [];
  } catch {
    return [];
  }
}

function write(items: OutboxItem[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(items.slice(-200)));
  } catch {
    // Storage full or blocked: the message stays only in memory for this page.
  }
  window.dispatchEvent(new Event("cm:outbox"));
}

export function outboxFor(conversationId: string): OutboxItem[] {
  return read().filter((i) => i.conversationId === conversationId);
}

export function putOutbox(item: OutboxItem) {
  write([...read().filter((i) => i.clientId !== item.clientId), item]);
}

export function dropOutbox(clientId: string) {
  write(read().filter((i) => i.clientId !== clientId));
}

export function onOutboxChange(run: () => void) {
  window.addEventListener("cm:outbox", run);
  return () => window.removeEventListener("cm:outbox", run);
}

export function newClientId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // Older browsers: a version-4 UUID from random bytes.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
