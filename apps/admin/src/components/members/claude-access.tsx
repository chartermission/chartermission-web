"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { AdminMemberRow, McpActivityView, Page } from "@chartermission/contracts";
import { Button, Icon, cn } from "@chartermission/ui";
import { DateTime } from "@/components/time";
import { api, errorMessage } from "@/lib/api/client";
import { MCP_ACTION_LABELS, MCP_TARGET_LABELS } from "@/lib/labels";
import { webHref } from "@/lib/navigation";
import { useT } from "@/i18n/client";

/**
 * Claude (MCP) access for one member: the switch (PUT /admin/members/{id}/mcp-access) and what
 * Claude did on their account (GET /admin/members/{id}/mcp-activity). Turning access off revokes
 * every connection, so it asks first. Mount it to open; the parent unmounts it on close.
 */
export function ClaudeAccessDialog({
  member,
  onChanged,
  onClose,
}: {
  member: AdminMemberRow;
  onChanged: (row: AdminMemberRow) => void;
  onClose: () => void;
}) {
  const t = useT();
  const id = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const [row, setRow] = useState(member);
  const [busy, setBusy] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  async function setAccess(enabled: boolean) {
    setBusy(true);
    setError(null);
    try {
      const next = await api<AdminMemberRow>(`/admin/members/${row.id}/mcp-access`, { method: "PUT", body: { enabled } });
      setRow(next);
      setConfirmOff(false);
      onChanged(next);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  // Team members always have access; the switch only adds or removes access given by hand.
  const locked = row.staff;

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-title`}
      onClose={onClose}
      onCancel={(event) => {
        if (busy) event.preventDefault();
      }}
      className="m-auto max-h-[calc(100dvh-32px)] w-[600px] max-w-[calc(100vw-32px)] rounded-card border border-line bg-card p-0 text-ink shadow-[0_12px_40px_rgba(25,37,80,0.18)] backdrop:bg-primary-dark/40"
    >
      <div className="flex flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 id={`${id}-title`} className="text-h3 text-ink">
              {t("Claude for {name}", { name: row.name })}
            </h2>
            <p className="text-sm text-body">
              With Claude access, a member can connect Claude to their own account and ask it to post, comment, react, connect and follow as
              themselves, within hourly limits. Every change is in the audit log.
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => ref.current?.close()}
            className="-m-1 rounded-md p-1 text-secondary hover:bg-muted hover:text-ink"
          >
            <Icon name="x" size={18} label="Close" />
          </button>
        </div>

        <div className={cn("flex items-start gap-3 rounded-lg border border-line p-3", locked && "opacity-80")}>
          <button
            type="button"
            role="switch"
            aria-checked={row.mcpAccess}
            aria-label="Claude access"
            disabled={busy || locked}
            onClick={() => (row.mcpAccess ? setConfirmOff(true) : void setAccess(true))}
            className={cn(
              "relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60",
              row.mcpAccess ? "bg-primary" : "bg-line-strong",
            )}
          >
            <span className={cn("inline-block size-5 rounded-full bg-white shadow transition-transform", row.mcpAccess ? "translate-x-[22px] rtl:-translate-x-[22px]" : "translate-x-0.5 rtl:-translate-x-0.5")} />
          </button>
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-ink">Claude access</span>
            <span className="text-xs text-secondary">
              {locked
                ? "Team members can always connect Claude."
                : row.mcpAccess
                  ? t("On · {count} active connections", { count: row.mcpConnections })
                  : "Off. They can’t connect Claude."}
            </span>
          </div>
        </div>

        {confirmOff && (
          <div role="alert" className="flex flex-col gap-3 rounded-lg border border-error/30 bg-error-light p-3">
            <p className="text-sm text-ink">
              <strong className="font-semibold">This disconnects Claude from their account.</strong>{" "}
              {t("{count} active connections will stop working at once, and they can’t connect again until access is turned back on.", { count: row.mcpConnections })}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="small" disabled={busy} onClick={() => setConfirmOff(false)}>
                Keep access
              </Button>
              <Button size="small" disabled={busy} aria-busy={busy} className="bg-error hover:bg-error/90" onClick={() => void setAccess(false)}>
                {busy ? "Turning off…" : "Turn off and disconnect"}
              </Button>
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="flex items-start gap-2 rounded-lg bg-error-light p-3 text-sm text-error">
            <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
            {error}
          </p>
        )}

        <ClaudeActivity memberId={row.id} />
      </div>
    </dialog>
  );
}

function ClaudeActivity({ memberId }: { memberId: string }) {
  const [page, setPage] = useState<Page<McpActivityView> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(cursor?: string | null) {
    setLoading(true);
    setError(null);
    try {
      const next = await api<Page<McpActivityView>>(`/admin/members/${memberId}/mcp-activity`, { query: { cursor: cursor ?? undefined, limit: 20 } });
      setPage((prev) => (cursor && prev ? { items: [...prev.items, ...next.items], nextCursor: next.nextCursor } : next));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  // First page on open; later pages (and a retry) come from load().
  useEffect(() => {
    const controller = new AbortController();
    api<Page<McpActivityView>>(`/admin/members/${memberId}/mcp-activity`, { query: { limit: 20 }, signal: controller.signal })
      .then(setPage, (e: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [memberId]);

  return (
    <section aria-labelledby={`claude-activity-${memberId}`} className="flex flex-col gap-2">
      <h3 id={`claude-activity-${memberId}`} className="text-label font-semibold text-ink">
        Activity by Claude
      </h3>
      <div className={cn("max-h-[45dvh] overflow-y-auto rounded-lg border border-line", loading && "opacity-70")} aria-busy={loading}>
        {page && page.items.length > 0 ? (
          <ul className="divide-y divide-line">
            {page.items.map((item) => {
              const target = item.targetType ? MCP_TARGET_LABELS[item.targetType] : null;
              return (
                <li key={item.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="font-medium text-ink">
                      {MCP_ACTION_LABELS[item.action]}
                      {target && <span className="font-normal text-secondary"> · {target}</span>}
                    </span>
                    <span className="text-xs text-secondary">
                      {item.clientName} · <DateTime iso={item.createdAt} />
                    </span>
                  </div>
                  {item.href && (
                    <a href={webHref(item.href)} target="_blank" rel="noreferrer" className="shrink-0 text-xs font-medium text-primary hover:underline">
                      Open
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        ) : loading ? (
          <p className="px-3 py-6 text-center text-sm text-secondary">Loading…</p>
        ) : !error ? (
          <p className="px-3 py-6 text-center text-sm text-secondary">Claude hasn’t done anything on this account yet.</p>
        ) : null}
        {error && (
          <p role="alert" className="px-3 py-4 text-sm text-error">
            {error}
          </p>
        )}
      </div>
      {(page?.nextCursor || (error && !page)) && (
        <div className="flex justify-center">
          <Button variant="secondary" size="small" disabled={loading} onClick={() => void load(error && !page ? null : page?.nextCursor)}>
            {loading ? "Loading…" : error && !page ? "Try again" : "Load more"}
          </Button>
        </div>
      )}
    </section>
  );
}
