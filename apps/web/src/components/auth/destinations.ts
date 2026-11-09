import type { SessionUser } from "@chartermission/contracts";

/**
 * Accept only same-origin relative paths for `next` ("/feed?x=1"), never "//evil.com", "/\evil.com"
 * or absolute URLs, so a sign-in link can't bounce members to another site.
 */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || typeof next !== "string") return null;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return null;
  if (/[\u0000-\u001f]/.test(next)) return null;
  try {
    const url = new URL(next, "http://same-origin.invalid");
    if (url.origin !== "http://same-origin.invalid") return null;
    // Never bounce back into the auth screens themselves.
    if (/^\/(signin|signup|sign-in|check-email|forgot-password|reset-password)(\/|$)/.test(url.pathname)) return null;
    return url.pathname + url.search + url.hash;
  } catch {
    return null;
  }
}

/**
 * Where a member goes after signing in or verifying: unfinished onboarding first, then changed
 * policies, then the requested page or the feed.
 */
export function destinationFor(viewer: Pick<SessionUser, "onboarding" | "needsPolicyReaccept" | "status" | "mfa">, next?: string | null) {
  const target = safeNext(next) ?? "/feed";
  // Staff accounts set up two-step verification before anything else.
  if (viewer.mfa.required && !viewer.mfa.enabled) return `/signin/mfa-setup?next=${encodeURIComponent(target)}`;
  const canOnboard = viewer.status === "active" || viewer.status === "unverified";
  if (canOnboard && !viewer.onboarding.completed) return "/onboarding";
  if (viewer.needsPolicyReaccept) return `/policies/accept?next=${encodeURIComponent(target)}`;
  return target;
}
