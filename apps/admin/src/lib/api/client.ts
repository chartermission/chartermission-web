"use client";

import { ApiError } from "./errors";

type Query = Record<string, string | number | boolean | undefined | null>;

function withQuery(path: string, query?: Query) {
  if (!query) return path;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

/**
 * Browser call to the API through the same-origin `/api/v1` rewrite, so the session cookie is
 * first-party. Unsafe methods send the CSRF header the API requires.
 */
export async function api<T = unknown>(
  path: string,
  init: { method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; body?: unknown; query?: Query; signal?: AbortSignal } = {},
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
  if (!res.ok) throw await ApiError.from(res);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export { ApiError, isApiError } from "./errors";
