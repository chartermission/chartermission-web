"use client";

import { useState } from "react";
import type { SessionView } from "@chartermission/contracts";
import { Button, Chip, Icon } from "@chartermission/ui";
import { api, isApiError } from "@/lib/api/client";
import { describeUserAgent, formatDateTime } from "@/components/account/format";
import { SettingsCard } from "./settings-card";
import { T, useT } from "@/i18n/client";

/** Active sessions (GET /me/sessions) with "this device" and sign-out of the others (DELETE /me/sessions/{id}). */
export function SessionsList({ initial }: { initial: SessionView[] }) {
  const t = useT();
  const [sessions, setSessions] = useState(initial);
  const [busy, setBusy] = useState<string | "others" | null>(null);
  const [status, setStatus] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const others = sessions.filter((session) => !session.current);

  async function revoke(ids: string[]) {
    const results = await Promise.allSettled(ids.map((id) => api(`/me/sessions/${id}`, { method: "DELETE" })));
    const failed = results.flatMap((result, index) =>
      result.status === "rejected" && !(isApiError(result.reason) && result.reason.status === 404) ? [ids[index]] : [],
    );
    setSessions((prev) => prev.filter((session) => !ids.includes(session.id) || failed.includes(session.id)));
    return failed;
  }

  async function signOutOne(session: SessionView) {
    setBusy(session.id);
    setStatus(null);
    const failed = await revoke([session.id]);
    setBusy(null);
    setStatus(
      failed.length
        ? { tone: "error", text: "That session couldn’t be signed out. Please try again." }
        : { tone: "success", text: t("Signed out {describeUserAgent}.", { describeUserAgent: describeUserAgent(session.userAgent) }) },
    );
  }

  async function signOutOthers() {
    setBusy("others");
    setStatus(null);
    const failed = await revoke(others.map((session) => session.id));
    setBusy(null);
    setStatus(
      failed.length
        ? {
            tone: "error",
            text: t("{count} sessions couldn’t be signed out. Please try again.", { count: failed.length }),
          }
        : { tone: "success", text: "All other sessions were signed out." },
    );
  }

  return (
    <SettingsCard
      id="sessions"
      title="Where you’re signed in"
      description="Sessions end after 14 days without activity or 30 days in total."
      aside={
        others.length > 0 ? (
          <Button variant="secondary" size="small" onClick={() => void signOutOthers()} disabled={busy !== null}>
            {busy === "others" ? "Signing out…" : "Sign out all others"}
          </Button>
        ) : undefined
      }
    >
      {sessions.map((session) => (
        <li key={session.id} className="flex items-center gap-3 py-3.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-secondary">
            <Icon name={/Mobile|Android|iPhone/.test(session.userAgent ?? "") ? "message" : "dashboard"} size={18} />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
              {describeUserAgent(session.userAgent)}
              {session.current && (
                <Chip tone="success" className="px-2 py-0.5 text-xs">
                  This device
                </Chip>
              )}
            </span>
            <span className="text-xs text-secondary">
              <T vars={{ dateTime: formatDateTime(session.createdAt), dateTime2: formatDateTime(session.lastSeenAt) }}>{"Signed in {dateTime} · Last active {dateTime2}"}</T>
            </span>
          </div>
          {!session.current && (
            <Button variant="ghost" size="small" onClick={() => void signOutOne(session)} disabled={busy !== null}>
              {busy === session.id ? "Signing out…" : "Sign out"}
              <span className="sr-only"> {describeUserAgent(session.userAgent)}</span>
            </Button>
          )}
        </li>
      ))}
      {others.length === 0 && <li className="py-3.5 text-sm text-secondary">You’re not signed in anywhere else.</li>}
      <li aria-live="polite" className="empty:hidden">
        {status && (
          <p className={status.tone === "error" ? "py-3 text-sm text-error" : "py-3 text-sm text-success"}>{status.text}</p>
        )}
      </li>
    </SettingsCard>
  );
}
