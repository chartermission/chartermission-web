"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { DevMailbox as DevMailboxResponse } from "@chartermission/contracts";
import { Icon } from "@chartermission/ui";
import { api, isApiError } from "@/lib/api/client";

const POLL_MS = 2500;
const POLL_FOR_MS = 90_000;

const patterns = {
  verify: /https?:\/\/[^\s"'<>]*\/verify-email\?token=[A-Za-z0-9_-]+/,
  reset: /https?:\/\/[^\s"'<>]*\/reset-password\?token=[A-Za-z0-9_-]+/,
} as const;

/** Keep links same-origin (the API may build them for another host). */
function toPath(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.pathname + parsed.search;
  } catch {
    return url;
  }
}

/**
 * Development only: reads GET /dev/mailbox?to= and shows the newest verification or reset link,
 * so flows can be tested without an inbox. Renders nothing when the endpoint 404s (DEV_TOOLS off).
 */
export function DevMailbox({ email, kind }: { email: string; kind: keyof typeof patterns }) {
  const [state, setState] = useState<{ link: string | null; subject: string | null; checkedAt: number } | "off" | null>(null);

  const check = useCallback(async () => {
    try {
      const mailbox = await api<DevMailboxResponse>("/dev/mailbox", { query: { to: email } });
      for (const item of mailbox.items) {
        const match = item.text?.match(patterns[kind]);
        if (match) {
          setState({ link: toPath(match[0]), subject: item.subject, checkedAt: Date.now() });
          return true;
        }
      }
      setState({ link: null, subject: null, checkedAt: Date.now() });
      return false;
    } catch (error) {
      if (isApiError(error) && (error.status === 404 || error.status === 422 || error.status === 400)) setState("off");
      return true;
    }
  }, [email, kind]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    const tick = async () => {
      const done = await check();
      if (!cancelled && !done && Date.now() - started < POLL_FOR_MS) timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [check]);

  if (process.env.NODE_ENV !== "development" || state === "off" || state === null) return null;

  return (
    <aside
      aria-label="Development mailbox"
      className="flex w-full flex-col gap-2 rounded-lg border border-dashed border-warning bg-warning-light p-3 text-xs text-body"
    >
      <p className="flex items-center gap-1.5 font-semibold text-ink">
        <Icon name="mail" size={14} className="text-warning" />
        Dev mailbox · {email}
      </p>
      {state.link ? (
        <>
          <p className="text-secondary">{state.subject}</p>
          <Link href={state.link} className="break-all font-medium text-primary-light underline underline-offset-2">
            {kind === "verify" ? "Open verification link" : "Open reset link"}
          </Link>
        </>
      ) : (
        <p className="text-secondary" aria-live="polite">
          No {kind === "verify" ? "verification" : "reset"} email yet — checking…{" "}
          <button type="button" onClick={() => void check()} className="font-medium text-primary-light underline">
            Check now
          </button>
        </p>
      )}
    </aside>
  );
}
