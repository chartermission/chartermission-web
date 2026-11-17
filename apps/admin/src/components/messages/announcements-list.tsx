"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { AnnouncementView, AnnouncementsPage } from "@chartermission/contracts";
import { Button, Icon, buttonClasses } from "@chartermission/ui";
import { SkeletonTable } from "@/components/skeletons";
import { EmptyState } from "@/components/states";
import { DateTime } from "@/components/time";
import { toast } from "@/components/toast";
import { api, errorMessage } from "@/lib/api/client";
import { NoTranslate } from "@/i18n/auto";
import { useIntlTag, useT } from "@/i18n/client";
import { ChannelIcons, StatusChip } from "./shared";

const PAGE_SIZE = 20;
const POLL_MS = 15_000;

/** Sent or draft bulk messages (GET /admin/announcements?status), newest first, with "Load more". */
export function AnnouncementsList({ status }: { status: "draft" | "sent" }) {
  const t = useT();
  const tag = useIntlTag();
  const [rows, setRows] = useState<AnnouncementView[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const loaded = useRef(0);
  const drafts = status === "draft";

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setError(null);
      try {
        const limit = quiet ? Math.min(50, Math.max(PAGE_SIZE, loaded.current)) : PAGE_SIZE;
        const page = await api<AnnouncementsPage>("/admin/announcements", { query: { status, limit } });
        setRows(page.items);
        setCursor(page.nextCursor);
        loaded.current = page.items.length;
      } catch (e) {
        if (!quiet) setError(errorMessage(e));
      }
    },
    [status],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  // Messages still going out: refresh their counts and status every 15 seconds.
  const sending = rows?.some((r) => r.status === "sending") ?? false;
  useEffect(() => {
    if (!sending) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [sending, load]);

  async function more() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await api<AnnouncementsPage>("/admin/announcements", { query: { status, cursor, limit: PAGE_SIZE } });
      setRows((list) => {
        const next = [...(list ?? []), ...page.items.filter((a) => !list?.some((o) => o.id === a.id))];
        loaded.current = next.length;
        return next;
      });
      setCursor(page.nextCursor);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setLoadingMore(false);
    }
  }

  if (error) {
    return (
      <div role="alert" className="flex flex-col items-center gap-3 rounded-card border border-line bg-card px-6 py-10 text-center">
        <p className="max-w-md text-sm text-body">{error}</p>
        <Button variant="secondary" size="small" onClick={() => void load()}>
          Try again
        </Button>
      </div>
    );
  }
  if (rows === null) return <SkeletonTable label={drafts ? t("Loading drafts") : t("Loading sent messages")} rows={5} />;

  return (
    <div className="overflow-hidden rounded-card border border-line bg-card">
      {rows.length === 0 ? (
        <EmptyState icon={drafts ? "edit" : "send"} title={drafts ? t("No drafts") : t("Nothing sent yet")}>
          <span className="flex flex-col items-center gap-3">
            {drafts ? "Messages you save without sending wait here." : "Bulk messages you send to members appear here, with how many each one reached."}
            <Link href="/messages/new" className={buttonClasses({ variant: "primary", size: "small" })}>
              <Icon name="plus" size={16} />
              New message
            </Link>
          </span>
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-start text-sm">
            <caption className="sr-only">{drafts ? "Draft messages, newest first" : "Sent messages, newest first"}</caption>
            <thead className="bg-muted text-label text-secondary uppercase">
              <tr>
                <th scope="col" className="py-3 ps-4 pe-3 text-start font-semibold">Subject</th>
                <th scope="col" className="w-[110px] py-3 pe-3 text-start font-semibold">Channels</th>
                {!drafts && <th scope="col" className="w-[120px] py-3 pe-3 text-end font-semibold">Recipients</th>}
                <th scope="col" className="w-[120px] py-3 pe-3 text-start font-semibold">Status</th>
                <th scope="col" className="w-[170px] py-3 pe-3 text-start font-semibold">{drafts ? "Created" : "Sent"}</th>
                <th scope="col" className="w-[170px] py-3 pe-4 text-start font-semibold">{drafts ? "Written by" : "Sent by"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((a) => {
                const when = drafts ? a.createdAt : (a.queuedAt ?? a.createdAt);
                const who = drafts ? a.createdBy : (a.sentBy ?? a.createdBy);
                const progress = a.status === "sending" && a.counts.recipients > 0 ? Math.round(((a.counts.recipients - a.counts.remaining) / a.counts.recipients) * 100) : null;
                return (
                  <tr key={a.id} className="align-top text-body hover:bg-surface">
                    <td className="py-3 ps-4 pe-3">
                      <span className="flex min-w-0 flex-col gap-1">
                        <Link href={`/messages/${a.id}`} className="font-medium break-words text-ink hover:text-primary hover:underline">
                          <NoTranslate>{a.subject || t("(No subject)")}</NoTranslate>
                        </Link>
                        {a.important && (
                          <span className="inline-flex w-fit items-center gap-1 text-xs font-medium text-warning">
                            <Icon name="alert" size={12} />
                            Important service notice
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="py-3 pe-3">
                      <ChannelIcons channels={a.channels} />
                    </td>
                    {!drafts && <td className="py-3 pe-3 text-end text-ink tabular-nums">{a.counts.recipients.toLocaleString(tag)}</td>}
                    <td className="py-3 pe-3">
                      <span className="flex flex-col gap-1">
                        <StatusChip status={a.status} className="w-fit" />
                        {progress !== null && <span className="text-xs text-secondary tabular-nums">{progress}%</span>}
                        {a.status !== "draft" && a.counts.failed > 0 && <span className="text-xs text-error">{t("{count} failed", { count: a.counts.failed })}</span>}
                      </span>
                    </td>
                    <td className="py-3 pe-3 text-secondary">
                      <DateTime iso={when} />
                    </td>
                    <td className="py-3 pe-4 text-secondary">{who ? <NoTranslate>{who.name}</NoTranslate> : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {cursor && (
        <div className="flex justify-center border-t border-line px-4 py-3">
          <Button variant="secondary" size="small" disabled={loadingMore} aria-busy={loadingMore} onClick={() => void more()}>
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </div>
  );
}
