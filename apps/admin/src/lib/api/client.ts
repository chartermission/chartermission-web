"use client";

import { ApiError } from "./errors";
import { signInUrl } from "@/lib/navigation";

type Query = Record<string, string | number | boolean | undefined | null>;

function withQuery(path: string, query?: Query) {
  if (!query) return path;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

/** Fired on every API response so the session timer can restart its idle countdown. */
export const API_ACTIVITY_EVENT = "cm-admin:api-activity";

function currentPath() {
  return window.location.pathname + window.location.search;
}

/**
 * The admin session ended (30-minute idle timeout, revoked, or MFA no longer verified):
 * send the admin back through sign-in, returning here afterwards.
 */
function handleSessionLoss(error: ApiError) {
  // A full page load on purpose: it drops the client router cache, which holds pages from the dead session.
  /* eslint-disable @next/next/no-location-assign-relative-destination */
  if (error.code === "UNAUTHENTICATED") {
    window.location.assign(signInUrl({ next: currentPath(), expired: true }));
  } else if (error.code === "MFA_REQUIRED") {
    window.location.assign(`/signin/mfa?next=${encodeURIComponent(currentPath())}`);
  } else if (error.code === "MFA_SETUP_REQUIRED") {
    window.location.assign(`/signin/mfa-setup?next=${encodeURIComponent(currentPath())}`);
  }
  /* eslint-enable @next/next/no-location-assign-relative-destination */
}

/**
 * Browser call to the API through the same-origin `/api/v1` rewrite, so the session cookie is
 * first-party. Unsafe methods send the CSRF header the API requires.
 * Set `authFlow` on sign-in and MFA calls so a 401/403 is returned to the form instead of redirecting.
 */
export async function api<T = unknown>(
  path: string,
  init: {
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    body?: unknown;
    query?: Query;
    signal?: AbortSignal;
    authFlow?: boolean;
  } = {},
): Promise<T> {
  const method = init.method ?? (init.body === undefined ? "GET" : "POST");
  const headers: Record<string, string> = { accept: "application/json", "x-cm-audience": "admin" };
  if (method !== "GET") headers["x-cm-csrf"] = "1";
  if (init.body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`/api/v1${withQuery(path, init.query)}`, {
    method,
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: "same-origin",
    signal: init.signal,
  }).catch((e: unknown) => {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError(0, "NETWORK_ERROR", "You appear to be offline. Check your connection and try again.");
  });
  if (!res.ok) {
    const error = await ApiError.from(res);
    if (!init.authFlow) handleSessionLoss(error);
    throw error;
  }
  window.dispatchEvent(new Event(API_ACTIVITY_EVENT));
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Message for an error caught from `api()`, with "Try again in N minutes" for rate limits. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 429 && e.retryAfter) return `${e.message.replace(/ Try again later\.?$/, "")} ${retryText(e.retryAfter)}`;
    if (e.fields && Object.keys(e.fields).length > 0 && e.code === "VALIDATION_FAILED") {
      return Object.values(e.fields).join(" ");
    }
    return e.message;
  }
  return "Something went wrong. Please try again.";
}

/** "Try again in 12 minutes" from a Retry-After value in seconds. */
export function retryText(seconds: number): string {
  if (seconds < 60) return `Try again in ${seconds} second${seconds === 1 ? "" : "s"}.`;
  const minutes = Math.ceil(seconds / 60);
  return `Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

export { ApiError, isApiError } from "./errors";
