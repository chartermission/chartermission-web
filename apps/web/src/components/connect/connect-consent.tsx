"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { OAuthAuthorizeCheck, OAuthAuthorizeResult } from "@chartermission/contracts";
import { Button, Icon, LogoMark, buttonClasses, type IconName } from "@chartermission/ui";
import { FormAlert } from "@/components/auth/fields";
import { MemberAvatar } from "@/components/social/post-parts";
import { ErrorNotice, VerifyEmailPrompt } from "@/components/social/errors";
import { NoTranslate } from "@/i18n/auto";
import { useT } from "@/i18n/client";
import { api, isApiError } from "@/lib/api/client";
import { MCP_HOURLY } from "@/lib/mcp";

const CAN = [
  "Publish and edit posts and drafts",
  "React to and comment on posts",
  "Read your feed, notifications and analytics",
  "Send and accept connection requests",
  "Follow members, chapters, topics and pages",
];

const CANNOT = ["Change your profile, password or settings", "Read your messages", "Use admin or moderation tools"];

/**
 * Claude's consent screen (OAuth authorization code + PKCE). The member allows or cancels; the API
 * answers with the client's redirect URI (?code&state, or ?error=access_denied&state) and the
 * browser goes there. Every OAuth query field goes back to the API exactly as it arrived.
 */
export function ConnectConsent({
  check,
  params,
  here,
  emailVerified,
}: {
  check: OAuthAuthorizeCheck;
  /** The OAuth request as it arrived in the address (response_type, client_id, redirect_uri, …). */
  params: Record<string, string>;
  /** This page's own address, to come back to after signing in again. */
  here: string;
  emailVerified: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState<"allow" | "deny" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const { client, member, allowed } = check;

  async function answer(approve: boolean) {
    if (busy) return;
    setBusy(approve ? "allow" : "deny");
    setError(null);
    try {
      const { redirectTo } = await api<OAuthAuthorizeResult>("/oauth/authorize", { method: "POST", body: { ...params, approve } });
      // Stay busy: the browser is leaving for the client's redirect URI.
      window.location.assign(redirectTo);
    } catch (e) {
      if (isApiError(e) && e.status === 401) {
        router.replace(`/signin?notice=expired&next=${encodeURIComponent(here)}`);
        return;
      }
      setBusy(null);
      // Nothing to return to Claude with: the Back button still leaves the page.
      if (!approve && !allowed) {
        window.history.back();
        return;
      }
      setError(e);
    }
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex items-center justify-center gap-3" aria-hidden="true">
        <LogoMark size={48} />
        <span className="flex items-center gap-1.5 text-secondary">
          <span className="h-px w-5 border-t-2 border-dotted border-line-strong" />
          <span className="flex size-7 items-center justify-center rounded-full bg-muted">
            <Icon name="link" size={14} />
          </span>
          <span className="h-px w-5 border-t-2 border-dotted border-line-strong" />
        </span>
        <span className="flex size-12 items-center justify-center rounded-xl border border-line bg-surface text-h2 text-ink">
          {(client.name.trim()[0] ?? "?").toUpperCase()}
        </span>
      </div>

      <header className="flex flex-col gap-2 text-center">
        <h1 className="text-h1 text-ink max-sm:text-h2">Connect Claude to your Charter Mission account</h1>
        <p className="text-md text-secondary">
          {t("{client} will return you to {host} after you choose.", { client: client.name, host: client.redirectHost })}
        </p>
      </header>

      <div className="flex items-center gap-3 rounded-lg border border-line bg-surface px-3.5 py-3">
        <MemberAvatar member={member} size={40} />
        <div className="flex min-w-0 flex-1 flex-col">
          <NoTranslate>
            <span className="truncate text-sm font-medium text-ink">{member.name}</span>
            <span dir="ltr" className="truncate text-start text-xs text-secondary">
              @{member.handle}
            </span>
          </NoTranslate>
        </div>
        <span className="shrink-0 text-xs text-secondary">Signed in</span>
      </div>

      {allowed ? (
        <>
          <PermissionList title="Claude will be able to" items={CAN} icon="check" iconClass="bg-success-light text-success" />
          <PermissionList title="Claude won’t be able to" items={CANNOT} icon="x" iconClass="bg-error-light text-error" />

          <p className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2.5 text-xs text-body">
            <Icon name="shield" size={16} className="mt-px shrink-0 text-secondary" />
            <span>
              {t(
                "Claude acts only as you and follows the same rules as the app. Each hour it can make up to {posts} posts (published or scheduled), {comments} comments and {requests} connection requests for you, and everything it does is listed in your settings.",
                MCP_HOURLY,
              )}
            </span>
          </p>

          {!emailVerified && (
            <FormAlert tone="warning" icon="mail">
              <VerifyEmailPrompt message="Verify your email address before connecting Claude. Check your inbox for the link." />
            </FormAlert>
          )}
          <div aria-live="polite" className="empty:hidden">
            {error ? <ErrorNotice error={error} /> : null}
          </div>

          <FormAlert tone="warning" icon="shield">
            Only continue if you just started connecting Charter Mission from your own Claude. If someone sent you this link, choose Cancel.
          </FormAlert>

          <div className="flex flex-col gap-3">
            <Button block onClick={() => void answer(true)} disabled={busy !== null || !emailVerified} aria-busy={busy === "allow"}>
              {busy === "allow" ? "Connecting…" : "Allow"}
            </Button>
            <Button block variant="secondary" onClick={() => void answer(false)} disabled={busy !== null} aria-busy={busy === "deny"}>
              {busy === "deny" ? "Cancelling…" : "Cancel"}
            </Button>
          </div>

          <p className="text-center text-xs text-secondary">You can disconnect anytime in Settings → Connected apps.</p>
        </>
      ) : (
        <>
          <div role="status" className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning-light p-4">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-card text-warning">
              <Icon name="shield" size={18} />
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <h2 className="text-md font-medium text-ink">Claude access isn’t turned on for this account</h2>
              <p className="text-sm text-body">
                Connecting Claude is open to members the Charter Mission team has given access. If you’d like to use it, ask the Charter Mission team to turn it on for you.
              </p>
            </div>
          </div>
          <Button block variant="secondary" onClick={() => void answer(false)} disabled={busy !== null} aria-busy={busy !== null}>
            <Icon name="chevron-left" size={18} />
            Back
          </Button>
        </>
      )}
    </div>
  );
}

function PermissionList({ title, items, icon, iconClass }: { title: string; items: string[]; icon: IconName; iconClass: string }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="text-label font-semibold text-ink">{title}</h2>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2.5 text-sm text-body">
            <span className={`mt-px flex size-5 shrink-0 items-center justify-center rounded-full ${iconClass}`}>
              <Icon name={icon} size={12} />
            </span>
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The consent page couldn't go ahead: a bad or expired request, or the check didn't load. */
export function ConnectProblem({ title, message, retry = false }: { title: string; message: string; retry?: boolean }) {
  return (
    <div className="flex w-full flex-col gap-6">
      <div role="alert" className="flex flex-col items-start gap-[18px]">
        <span className="flex size-12 items-center justify-center rounded-full bg-error-light text-error">
          <Icon name="alert" size={24} />
        </span>
        <div className="flex flex-col gap-1.5">
          <h1 className="text-h1 text-ink max-sm:text-h2">{title}</h1>
          <p className="text-md text-secondary">{message}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        {retry && (
          <Button onClick={() => window.location.reload()}>Try again</Button>
        )}
        <Link href="/feed" className={buttonClasses({ variant: "secondary" })}>
          Go to your feed
        </Link>
      </div>
    </div>
  );
}
