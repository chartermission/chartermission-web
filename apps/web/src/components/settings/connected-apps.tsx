"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { ConnectedAppView, McpActivityView, Page } from "@chartermission/contracts";
import { Button, Icon, type IconName } from "@chartermission/ui";
import { formatDateTime } from "@/components/account/format";
import { ConfirmDialog } from "@/components/social/confirm-dialog";
import { NoTranslate } from "@/i18n/auto";
import { useT } from "@/i18n/client";
import { api, isApiError } from "@/lib/api/client";
import { MCP_URL, mcpActionLabel } from "@/lib/mcp";
import { SettingsCard } from "./settings-card";

/** Shown instead of the list when the account may not connect Claude (not staff, no admin grant). */
export function ClaudeAccessOff() {
  return (
    <SettingsCard id="claude" title="Claude" list={false}>
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-secondary">
          <Icon name="shield" size={18} />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm font-medium text-ink">Claude access isn’t turned on for your account</p>
          <p className="text-sm text-secondary">
            With Claude access you can ask Claude to write and publish posts, reply to comments and keep up with your network for you. It’s open to members the Charter Mission team has given access: ask the team if you’d like it.
          </p>
        </div>
      </div>
    </SettingsCard>
  );
}

/** How to connect, the live connections (DELETE /me/connected-apps/{id}) and what Claude did. */
export function ConnectedApps({
  initial,
  activity,
  activityError,
}: {
  initial: ConnectedAppView[];
  activity: Page<McpActivityView> | null;
  activityError: string | null;
}) {
  return (
    <>
      <HowToConnect />
      <Connections initial={initial} />
      <Activity initial={activity} initialError={activityError} />
    </>
  );
}

function HowToConnect() {
  return (
    <SettingsCard id="connect" title="Connect Claude" description="Let Claude post, comment and keep up with your network as you." list={false}>
      <ol className="flex flex-col gap-3 text-sm text-body">
        <Step n={1}>In Claude, open Settings → Connectors and choose “Add custom connector”.</Step>
        <Step n={2}>
          <span className="flex flex-col gap-2">
            <span>Name it Charter Mission and paste this address:</span>
            <CopyField value={MCP_URL} label="Copy the connector address" />
          </span>
        </Step>
        <Step n={3}>Choose Connect, sign in to Charter Mission if asked, and allow access.</Step>
      </ol>
      <div className="flex flex-col gap-2 border-t border-line pt-4 text-sm text-body">
        <span>Using Claude Code? Run this in your terminal:</span>
        <CopyField value={`claude mcp add --transport http charter-mission ${MCP_URL}`} label="Copy the command" />
      </div>
    </SettingsCard>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-tint text-xs font-semibold text-primary">{n}</span>
      <span className="min-w-0 flex-1 pt-0.5">{children}</span>
    </li>
  );
}

function CopyField({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
    window.setTimeout(() => setState("idle"), 2000);
  }

  return (
    <span className="flex items-stretch gap-2">
      <NoTranslate>
        <code dir="ltr" className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-line bg-surface px-3 py-2 font-mono text-xs whitespace-nowrap text-ink">
          {value}
        </code>
      </NoTranslate>
      <Button variant="secondary" size="small" onClick={() => void copy()} aria-label={label}>
        <Icon name={state === "copied" ? "check" : "copy"} size={16} />
        <span aria-live="polite">{state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy"}</span>
      </Button>
    </span>
  );
}

function Connections({ initial }: { initial: ConnectedAppView[] }) {
  const t = useT();
  const [apps, setApps] = useState(initial);
  const [confirm, setConfirm] = useState<ConnectedAppView | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function disconnect(app: ConnectedAppView) {
    try {
      await api(`/me/connected-apps/${app.id}`, { method: "DELETE" });
    } catch (e) {
      // Already gone: treat it as disconnected.
      if (!(isApiError(e) && e.status === 404)) throw e;
    }
    setApps((prev) => prev.filter((a) => a.id !== app.id));
    setStatus(t("{name} was disconnected.", { name: app.clientName }));
  }

  return (
    <SettingsCard id="connections" title="Connections" description="Claude stays connected until you disconnect it or it goes unused for 30 days.">
      {apps.length === 0 ? (
        <li className="py-3.5 text-sm text-secondary">Claude isn’t connected to your account.</li>
      ) : (
        apps.map((app) => (
          <li key={app.id} className="flex items-center gap-3 py-3.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-tint text-primary">
              <Icon name="link" size={18} />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <NoTranslate>
                <span className="truncate text-sm font-medium text-ink">{app.clientName}</span>
              </NoTranslate>
              <span className="text-xs text-secondary">
                {app.lastUsedAt
                  ? t("Connected {connected} · Last used {used}", { connected: formatDateTime(app.connectedAt), used: formatDateTime(app.lastUsedAt) })
                  : t("Connected {connected} · Not used yet", { connected: formatDateTime(app.connectedAt) })}
              </span>
              <span className="text-xs text-secondary">{t("{count} actions in the last 7 days", { count: app.actionsLast7Days })}</span>
            </div>
            <Button variant="ghost" size="small" className="text-error hover:bg-error-light" onClick={() => setConfirm(app)}>
              Disconnect
              <span className="sr-only"> {app.clientName}</span>
            </Button>
          </li>
        ))
      )}
      <li aria-live="polite" className="empty:hidden">
        {status && <p className="py-3 text-sm text-success">{status}</p>}
      </li>
      {confirm && (
        <ConfirmDialog
          title={t("Disconnect {name}?", { name: confirm.clientName })}
          confirmLabel="Disconnect"
          danger
          onConfirm={() => disconnect(confirm)}
          onClose={() => setConfirm(null)}
        >
          Claude will no longer be able to use your account. What it already posted stays; you can connect it again anytime.
        </ConfirmDialog>
      )}
    </SettingsCard>
  );
}

const ACTION_ICON: Record<string, IconName> = {
  post: "edit",
  draft: "file",
  comment: "message",
  reaction: "like",
  connection: "user-plus",
  follow: "plus",
  unfollow: "x",
};

function Activity({ initial, initialError }: { initial: Page<McpActivityView> | null; initialError: string | null }) {
  const [items, setItems] = useState(initial?.items ?? []);
  const [cursor, setCursor] = useState(initial?.nextCursor ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError);

  async function loadMore() {
    setLoading(true);
    setError(null);
    try {
      const page = await api<Page<McpActivityView>>("/me/connected-apps/activity", { query: { cursor, limit: 20 } });
      setItems((prev) => (cursor ? [...prev, ...page.items] : page.items));
      setCursor(page.nextCursor);
    } catch (e) {
      setError(isApiError(e) ? e.message : "More activity didn’t load. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // The first page failed on the server: "Try again" reloads it from the start.
  const failedFirst = initial === null;

  return (
    <SettingsCard id="activity" title="Recent activity by Claude" description="Everything Claude did for you, newest first.">
      {items.length === 0 && !failedFirst && <li className="py-3.5 text-sm text-secondary">Claude hasn’t done anything for you yet.</li>}
      {items.map((item) => {
        const label = mcpActionLabel(item.action, item.targetType);
        return (
          <li key={item.id} className="flex items-center gap-3 py-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-secondary">
              <Icon name={ACTION_ICON[item.action] ?? ACTION_ICON[item.action.split(".")[0]!] ?? "check"} size={16} />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              {item.href ? (
                <Link href={item.href} className="text-sm font-medium text-ink hover:text-primary hover:underline">
                  {label}
                </Link>
              ) : (
                <span className="text-sm font-medium text-ink">{label}</span>
              )}
              <span className="text-xs text-secondary">
                <NoTranslate>{item.clientName}</NoTranslate> · {formatDateTime(item.createdAt)}
              </span>
            </div>
          </li>
        );
      })}
      {(cursor || error) && (
        <li className="flex flex-wrap items-center gap-3 py-3">
          {(cursor || failedFirst) && (
            <Button variant="ghost" size="small" onClick={() => void loadMore()} disabled={loading}>
              {loading ? "Loading…" : failedFirst && items.length === 0 ? "Try again" : "Show more"}
            </Button>
          )}
          {error && (
            <span role="alert" className="text-sm text-error">
              {error}
            </span>
          )}
        </li>
      )}
    </SettingsCard>
  );
}
