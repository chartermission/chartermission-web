"use client";

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { SignInResult } from "@chartermission/contracts";
import { Icon, buttonClasses } from "@chartermission/ui";
import { api } from "@/lib/api/client";
import { HOME_PATH, WEB_URL, safeNext } from "@/lib/navigation";

/**
 * Where single sign-on starts: an address on the member site, which knows whether this browser
 * is signed in there as a team member. It sends the browser back to /sso with a one-time code,
 * or to the sign-in form when single sign-on isn't available.
 */
export function ssoStartUrl(next?: string | null) {
  const safe = safeNext(next);
  return `${WEB_URL}/api/v1/auth/admin/sso/start${safe ? `?next=${encodeURIComponent(safe)}` : ""}`;
}

/**
 * The /sso page. With a code (just back from the member site): exchange it for a console session
 * and carry on, to the authenticator step if the code wasn't entered recently. Without one:
 * begin at the member site.
 */
export function SingleSignOnAuto() {
  const router = useRouter();
  const params = useSearchParams();
  const code = params.get("code");
  const next = safeNext(params.get("next"));
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!code) {
      window.location.replace(ssoStartUrl(next));
      return;
    }
    const q = next ? `?next=${encodeURIComponent(next)}` : "";
    api<SignInResult>("/auth/admin/sso", { method: "POST", body: { code }, authFlow: true }).then(
      (result) => {
        if (result.status === "mfa_setup_required") router.replace(`/signin/mfa-setup${q}`);
        else if (result.status === "mfa_required") router.replace(`/signin/mfa${q}`);
        else router.replace(next ?? HOME_PATH);
      },
      // An expired or used code: the ordinary sign-in form.
      () => router.replace(`/signin?sso=unavailable${next ? `&next=${encodeURIComponent(next)}` : ""}`),
    );
  }, [router, code, next]);

  return (
    <div className="flex flex-col items-center gap-3 py-6 text-center" role="status">
      <span className="size-8 animate-spin rounded-full border-2 border-line border-t-primary" aria-hidden />
      <p className="text-sm text-secondary">Opening the console with your Charter Mission account…</p>
    </div>
  );
}

/** On the sign-in page: skip the password when already signed in on the member site. */
export function SingleSignOn() {
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const unavailable = params.get("sso") === "unavailable";
  if (unavailable) {
    return (
      <p className="rounded-lg border border-line bg-surface px-4 py-3 text-xs text-secondary">
        Single sign-on needs you to be signed in on Charter Mission with your team account. Sign in below instead.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <a href={ssoStartUrl(next)} className={buttonClasses({ variant: "secondary", block: true })}>
        <Icon name="shield" size={16} />
        Continue with my Charter Mission sign-in
      </a>
      <p className="text-center text-xs text-secondary">For team members already signed in on the member site. No password needed.</p>
      <div className="flex items-center gap-3 text-xs text-secondary" aria-hidden>
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>
    </div>
  );
}
