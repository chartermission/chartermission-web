"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { AnnouncementSendResult, AnnouncementView } from "@chartermission/contracts";
import { Button, Icon } from "@chartermission/ui";
import { FormNotice } from "@/components/form-field";
import { ReasonDialog } from "@/components/reason-dialog";
import { DateTime } from "@/components/time";
import { toast } from "@/components/toast";
import { api } from "@/lib/api/client";
import { audienceLines, channelsText, type AudienceOptions } from "@/lib/messages";
import { countryNameOf } from "@/i18n/places";
import { NoTranslate } from "@/i18n/auto";
import { useIntlTag, useT } from "@/i18n/client";
import { CountTile, MessageBody, StatusChip } from "./shared";

const POLL_MS = 3000;

/**
 * A bulk message that was sent (or is sending, failed or was stopped): progress while it goes out,
 * how many members each channel reached, what it said, who it went to, and "Stop sending".
 */
export function AnnouncementDetail({ initial, options }: { initial: AnnouncementView; options: AudienceOptions }) {
  const t = useT();
  const tag = useIntlTag();
  const [a, setA] = useState(initial);
  const [stopping, setStopping] = useState(false);
  const sending = a.status === "sending";

  const reload = useCallback(async () => {
    try {
      setA(await api<AnnouncementView>(`/admin/announcements/${initial.id}`));
    } catch {
      // Keep what's on screen; the next tick tries again.
    }
  }, [initial.id]);

  // While it's going out, look again every 3 seconds (not while the tab is hidden).
  useEffect(() => {
    if (!sending) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [sending, reload]);

  async function stop() {
    const result = await api<AnnouncementSendResult>(`/admin/announcements/${a.id}/cancel`, { method: "POST" });
    setA(result.announcement);
    setStopping(false);
    toast(t("Stopped. Members already reached keep it."));
  }

  const { counts } = a;
  const processed = Math.max(0, counts.recipients - counts.remaining);
  const percent = counts.recipients > 0 ? Math.min(100, Math.round((processed / counts.recipients) * 100)) : 0;
  const lines = audienceLines(a.audience, options, t, tag, (code) => countryNameOf(code, tag) ?? code);
  const person = a.sentBy ?? a.createdBy;
  // Members who got it through at least one channel.
  const reached = Math.max(counts.emailed, counts.messaged, counts.notified);

  return (
    <div className="flex flex-col gap-5">
      <nav aria-label={t("Breadcrumb")} className="-mb-2 text-sm">
        <Link href="/messages/sent" className="inline-flex items-center gap-1 text-secondary hover:text-ink">
          <Icon name="chevron-left" size={16} className="rtl:rotate-180" />
          Sent
        </Link>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip status={a.status} />
            {a.important && (
              <span className="inline-flex items-center gap-1 rounded-full bg-warning-light px-2 py-0.5 text-xs font-medium text-warning">
                <Icon name="alert" size={12} />
                Important service notice
              </span>
            )}
          </div>
          <NoTranslate>
            <h1 className="text-h1 break-words text-ink">{a.subject}</h1>
          </NoTranslate>
          <p className="text-sm text-secondary">
            {channelsText(a.channels, t)}
            {person && <> · {a.sentBy ? t("Sent by {name}", { name: person.name }) : t("Written by {name}", { name: person.name })}</>}
            {a.queuedAt && (
              <>
                {" · "}
                <DateTime iso={a.queuedAt} />
              </>
            )}
            {a.finishedAt && a.status !== "sending" && (
              <>
                {" · "}
                {t("finished")} <DateTime iso={a.finishedAt} />
              </>
            )}
          </p>
        </div>
        {sending && (
          <Button variant="secondary" size="small" onClick={() => setStopping(true)}>
            <Icon name="stop" size={16} />
            Stop sending
          </Button>
        )}
      </div>

      {sending && (
        <div className="flex flex-col gap-2 rounded-card border border-line bg-card p-4">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="font-medium text-ink">{t("Sending… {done} of {total}", { done: processed, total: counts.recipients })}</span>
            <span className="text-secondary tabular-nums">{percent}%</span>
          </div>
          <div
            role="progressbar"
            aria-label={t("Sending progress")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="h-2 overflow-hidden rounded-full bg-muted"
          >
            <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${percent}%` }} />
          </div>
          <p className="text-xs text-secondary">This page updates by itself. You can leave it; sending carries on.</p>
        </div>
      )}
      {a.status === "failed" && (
        <FormNotice tone="error">
          {a.lastError ? t("Sending failed: {error}", { error: a.lastError }) : t("Sending failed.")}
          {reached > 0 && <> {t("{count} members were reached before it stopped.", { count: reached })}</>}
        </FormNotice>
      )}
      {a.status === "cancelled" && (
        <FormNotice tone="warning">
          {t("Stopped before everyone got it. {count} members were reached and keep it.", { count: reached })}
        </FormNotice>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <CountTile label={t("Recipients")} value={counts.recipients} />
        <CountTile label={t("Emailed")} value={a.channels.email ? counts.emailed : "—"} />
        <CountTile label={t("Messaged")} value={a.channels.message ? counts.messaged : "—"} />
        <CountTile label={t("Notified")} value={a.channels.notification ? counts.notified : "—"} />
        <CountTile label={t("Turned emails off")} value={a.channels.email ? counts.optedOut : "—"} />
        <CountTile label={t("Failed")} value={counts.failed} tone={counts.failed > 0 ? "error" : undefined} />
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-labelledby="content-title" className="flex min-w-0 flex-col gap-3 rounded-card border border-line bg-card p-5">
          <h2 id="content-title" className="text-h3 text-ink">
            Message
          </h2>
          <MessageBody text={a.body} className="text-sm text-body" linkClassName="text-primary" />
          {a.linkUrl && (
            <p className="flex flex-wrap items-center gap-2 border-t border-line pt-3 text-sm">
              <span className="text-secondary">{t("Link:")}</span>
              <a href={a.linkUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium break-all text-primary hover:underline">
                <NoTranslate>{a.linkLabel || a.linkUrl}</NoTranslate>
                <Icon name="external" size={12} />
              </a>
            </p>
          )}
        </section>
        <section aria-labelledby="audience-title" className="flex flex-col gap-3 rounded-card border border-line bg-card p-5">
          <h2 id="audience-title" className="text-h3 text-ink">
            Audience
          </h2>
          {lines.length === 0 ? (
            <p className="text-sm text-body">Every active member</p>
          ) : (
            <dl className="flex flex-col gap-2 text-sm">
              {lines.map((line) => (
                <div key={line.label} className="flex flex-col gap-0.5">
                  <dt className="text-xs text-secondary">{line.label}</dt>
                  <dd className="break-words text-body">{line.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {a.createdBy && a.sentBy && a.createdBy.id !== a.sentBy.id && (
            <p className="border-t border-line pt-3 text-xs text-secondary">
              {t("Written by {name}", { name: a.createdBy.name })} · <DateTime iso={a.createdAt} />
            </p>
          )}
        </section>
      </div>

      {stopping && (
        <ReasonDialog
          title="Stop sending?"
          description="Members who haven’t got it yet won’t get it. Members already reached keep it. You can’t restart it, but you can write a new message."
          confirmLabel="Stop sending"
          tone="danger"
          reasonField="none"
          onClose={() => setStopping(false)}
          onConfirm={stop}
        />
      )}
    </div>
  );
}
