/** Where the console opens after sign-in when there is no `next`. */
export const HOME_PATH = "/moderation";

/** Only same-origin console paths are followed after sign-in (no open redirects, no sign-in loops). */
export function safeNext(next: string | string[] | null | undefined): string | null {
  const value = Array.isArray(next) ? next[0] : next;
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  if (value === "/signin" || value.startsWith("/signin/") || value.startsWith("/signin?")) return null;
  if (value === "/sso" || value.startsWith("/sso?")) return null;
  return value;
}

export function signInUrl({ next, expired, signedOut }: { next?: string | null; expired?: boolean; signedOut?: boolean } = {}) {
  const qs = new URLSearchParams();
  const safe = safeNext(next);
  if (safe) qs.set("next", safe);
  if (expired) qs.set("expired", "1");
  if (signedOut) qs.set("signedout", "1");
  const s = qs.toString();
  return s ? `/signin?${s}` : "/signin";
}

/**
 * Base URL of the member web app, for "View on site" links. NEXT_PUBLIC_WEB_URL is fixed when the
 * console is built; a production build without it (or with a local address left in) links to the
 * live site rather than to localhost.
 */
const CONFIGURED_WEB_URL = process.env.NEXT_PUBLIC_WEB_URL?.trim();
const LOCAL_URL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?/i;
export const WEB_URL = (
  process.env.NODE_ENV === "production"
    ? CONFIGURED_WEB_URL && !LOCAL_URL.test(CONFIGURED_WEB_URL)
      ? CONFIGURED_WEB_URL
      : "https://chartermission.com"
    : CONFIGURED_WEB_URL || "http://localhost:3000"
).replace(/\/+$/, "");

export function webHref(path: string) {
  return `${WEB_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
