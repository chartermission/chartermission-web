"use client";

import { useState } from "react";
import {
  OPPORTUNITY_TYPE_LABELS,
  type AdminApplicationsPage,
  type AdminApplicationView,
  type AdminOpportunityRow,
  type ApplicationStatus,
  type DecideApplicationInput,
} from "@chartermission/contracts";
import { Avatar, Button, Chip, Icon, Panel, cn, type ChipTone } from "@chartermission/ui";
import { FormNotice } from "@/components/form-field";
import { ReasonDialog } from "@/components/reason-dialog";
import { EmptyState } from "@/components/states";
import { DateTime } from "@/components/time";
import { toast } from "@/components/toast";
import { api, errorMessage } from "@/lib/api/client";
import { formatCount } from "@/lib/format";
import { webHref } from "@/lib/navigation";
import { applyHost } from "@/lib/opportunity-import";
import { useT } from "@/i18n/client";
import { DayDate, OPPORTUNITY_STATE } from "./opportunities-console";
import { PageMark } from "./post-as-picker";

type Tab = "all" | ApplicationStatus;
type Decision = DecideApplicationInput["status"];

const TABS: { value: Tab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "submitted", label: "New" },
  { value: "shortlisted", label: "Shortlisted" },
  { value: "accepted", label: "Accepted" },
  { value: "declined", label: "Not selected" },
  { value: "withdrawn", label: "Withdrawn" },
];

const STATUS: Record<ApplicationStatus, { label: string; tone: ChipTone }> = {
  submitted: { label: "New", tone: "info" },
  shortlisted: { label: "Shortlisted", tone: "warning" },
  accepted: { label: "Accepted", tone: "success" },
  declined: { label: "Not selected", tone: "neutral" },
  withdrawn: { label: "Withdrawn", tone: "neutral" },
};

const DONE: Record<Decision, string> = {
  submitted: "{name} is back under New.",
  shortlisted: "{name} is shortlisted. They’ve been told.",
  accepted: "{name} is accepted. They’ve been told.",
  declined: "{name} is marked not selected. They’ve been told.",
};

/** Under the "All" tab: every application except withdrawn ones. */
const allCount = (c: AdminApplicationsPage["counts"]) => c.submitted + c.shortlisted + c.accepted + c.declined;

function formatBytes(n: number) {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

/**
 * Applications to an imported opportunity that takes applications in Charter Mission
 * (GET /admin/opportunities/{id}/applications): status tabs with counts, each applicant with their
 * contact details, link, CV and note, and Shortlist / Accept / Decline (the applicant is notified, as
 * by a poster's decision). Export CSV downloads the current tab.
 */
export function ApplicationsConsole({ listing, initial }: { listing: AdminOpportunityRow; initial: AdminApplicationsPage }) {
  const t = useT();
  const [tab, setTab] = useState<Tab>("all");
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ app: AdminApplicationView; status: "accepted" | "declined" } | null>(null);
  const state = OPPORTUNITY_STATE[listing.state];
  const query = (next: Tab) => ({ status: next === "all" ? undefined : next, limit: 50 });

  async function load(next: Tab) {
    setTab(next);
    setLoading(true);
    try {
      setData(await api<AdminApplicationsPage>(`/admin/opportunities/${listing.id}/applications`, { query: query(next) }));
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setLoading(false);
    }
  }

  async function more() {
    if (!data.nextCursor) return;
    setLoading(true);
    try {
      const page = await api<AdminApplicationsPage>(`/admin/opportunities/${listing.id}/applications`, { query: { ...query(tab), cursor: data.nextCursor } });
      setData((d) => ({ ...page, items: [...d.items, ...page.items.filter((a) => !d.items.some((x) => x.id === a.id))] }));
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setLoading(false);
    }
  }

  async function decide(app: AdminApplicationView, status: Decision, message?: string) {
    setBusyId(app.id);
    try {
      const next = await api<AdminApplicationView>(`/admin/opportunities/${listing.id}/applications/${app.id}`, { method: "PATCH", body: { status, ...(message ? { message } : {}) } });
      setData((d) => {
        const counts = { ...d.counts };
        if (app.status !== next.status) {
          counts[app.status] = Math.max(0, counts[app.status] - 1);
          counts[next.status] += 1;
        }
        const stays = tab === "all" || tab === next.status;
        return { ...d, counts, items: stays ? d.items.map((a) => (a.id === next.id ? next : a)) : d.items.filter((a) => a.id !== next.id) };
      });
      toast(t(DONE[status], { name: app.applicant.name }));
    } catch (e) {
      toast(errorMessage(e), "error");
      throw e;
    } finally {
      setBusyId(null);
    }
  }

  const exportHref = `/opportunities/${listing.id}/applications/export${tab === "all" ? "" : `?status=${tab}`}`;
  const tabCount = (value: Tab) => (value === "all" ? allCount(data.counts) : data.counts[value]);

  return (
    <section className="flex flex-col gap-4">
      <Panel className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-xs text-secondary">{t("Applications · {type}", { type: t(OPPORTUNITY_TYPE_LABELS[listing.type]) })}</span>
            <h1 className="text-h2 text-ink" dir="auto">
              {listing.title}
            </h1>
            <span className="text-sm text-body" dir="auto">
              {listing.organisation}
            </span>
          </div>
          <a href={webHref(`/opportunities/${listing.slug}`)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-sm font-medium text-primary hover:bg-primary-tint-2">
            View on site
            <Icon name="external" size={14} />
          </a>
        </div>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-1">
            <dt className="text-label text-secondary uppercase">Posted as</dt>
            <dd className="flex min-w-0 items-center gap-2">
              {listing.page ? (
                <>
                  <PageMark page={listing.page} />
                  <a href={webHref(`/pages/${listing.page.slug}`)} target="_blank" rel="noreferrer" className="truncate font-medium text-ink hover:underline" dir="auto">
                    {listing.page.name}
                  </a>
                </>
              ) : (
                <span className="text-secondary">{listing.poster?.name ?? t("Deleted account")}</span>
              )}
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-label text-secondary uppercase">Deadline</dt>
            <dd className={cn(listing.state === "expired" ? "text-warning" : "text-ink")}>{listing.deadline ? <DayDate date={listing.deadline} /> : t("No deadline")}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-label text-secondary uppercase">Status</dt>
            <dd>
              <Chip tone={state.tone} className="px-2! py-0.5! text-xs!">
                {state.label}
              </Chip>
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-label text-secondary uppercase">Imported by</dt>
            <dd className="flex items-center gap-1.5 text-ink">
              <span dir="auto">{listing.poster?.name ?? t("Deleted account")}</span>
              <span className="text-secondary">
                · <DateTime iso={listing.createdAt} dateOnly />
              </span>
            </dd>
          </div>
        </dl>
        {listing.applyUrl && (
          <FormNotice tone="info">{t("People apply on the organisation’s side ({where}), so applications don’t come here.", { where: applyHost(listing.applyUrl) })}</FormNotice>
        )}
      </Panel>

      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label={t("Applications by status")} className="flex flex-wrap gap-1.5">
          {TABS.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={tab === item.value}
              onClick={() => void load(item.value)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium",
                tab === item.value ? "border-primary bg-primary text-inverse" : "border-line bg-card text-body hover:bg-muted",
              )}
            >
              {item.label}
              <span
                className={cn(
                  "tabular-nums",
                  tab === item.value ? "text-inverse/80" : item.value === "submitted" && data.counts.submitted > 0 ? "rounded-full bg-accent px-1.5 text-xs font-semibold text-inverse" : "text-secondary",
                )}
              >
                {formatCount(tabCount(item.value))}
              </span>
            </button>
          ))}
        </div>
        <a
          href={exportHref}
          download
          className={cn("ms-auto inline-flex items-center gap-1.5 rounded-md border border-line bg-card px-3 py-1.5 text-sm font-medium text-ink hover:bg-muted", !tabCount(tab) && "pointer-events-none opacity-50")}
          aria-disabled={!tabCount(tab) || undefined}
        >
          <Icon name="download" size={16} />
          Export CSV
        </a>
      </div>

      <div className={cn("flex flex-col gap-3", loading && "opacity-70")} aria-busy={loading}>
        {data.items.length === 0 ? (
          <div className="rounded-card border border-line bg-card">
            <EmptyState icon="users" title={tab === "all" ? "No applications yet" : "No applications here"}>
              {tab === "all" ? "When members apply with the form on the listing, their applications appear here." : "Try another tab."}
            </EmptyState>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {data.items.map((app) => (
              <ApplicationCard
                key={app.id}
                app={app}
                listingId={listing.id}
                busy={busyId === app.id}
                onShortlist={() => void decide(app, "shortlisted").catch(() => {})}
                onUndo={() => void decide(app, "submitted").catch(() => {})}
                onAccept={() => setConfirm({ app, status: "accepted" })}
                onDecline={() => setConfirm({ app, status: "declined" })}
              />
            ))}
          </ul>
        )}
      </div>
      {data.nextCursor && (
        <Button variant="secondary" size="small" className="self-center" disabled={loading} onClick={() => void more()}>
          Load more
        </Button>
      )}

      {confirm && (
        <ReasonDialog
          title={confirm.status === "accepted" ? t("Accept {name}?", { name: confirm.app.applicant.name }) : t("Decline {name}?", { name: confirm.app.applicant.name })}
          description={
            confirm.status === "accepted"
              ? "They get a notification and an email from Charter Mission saying their application was accepted."
              : "They get a notification and an email from Charter Mission saying they weren’t selected this time."
          }
          confirmLabel={confirm.status === "accepted" ? "Accept" : "Decline"}
          tone={confirm.status === "declined" ? "danger" : "primary"}
          reasonField="optional"
          minReasonLength={1}
          maxReasonLength={1000}
          reasonLabel="Message to the applicant"
          reasonPlaceholder={confirm.status === "accepted" ? "Next steps, who will contact them…" : "A short note to go with the decision"}
          reasonHint="Included in their notification and email."
          onClose={() => setConfirm(null)}
          onConfirm={async (message) => {
            await decide(confirm.app, confirm.status, message.trim() || undefined);
            setConfirm(null);
          }}
        />
      )}
    </section>
  );
}

function ApplicationCard({
  app,
  listingId,
  busy,
  onShortlist,
  onUndo,
  onAccept,
  onDecline,
}: {
  app: AdminApplicationView;
  listingId: string;
  busy: boolean;
  onShortlist: () => void;
  onUndo: () => void;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const status = STATUS[app.status];
  const long = app.note.length > 280 || app.note.split("\n").length > 3;
  const decided = app.status === "accepted" || app.status === "declined";
  return (
    <li className={cn("flex flex-col gap-3 rounded-card border bg-card p-4", app.status === "submitted" ? "border-info/40" : "border-line")}>
      <div className="flex flex-wrap items-start gap-3">
        <Avatar name={app.applicant.name} size={40} tone={app.applicant.tone} src={app.applicant.avatarUrl ?? undefined} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <a href={webHref(`/${app.applicant.handle}`)} target="_blank" rel="noreferrer" className="font-semibold text-ink hover:underline" dir="auto">
              {app.applicant.name}
            </a>
            <Chip tone={status.tone} className="px-2! py-0.5! text-xs!">
              {status.label}
            </Chip>
          </div>
          {app.applicant.headline && (
            <span className="truncate text-sm text-body" dir="auto">
              {app.applicant.headline}
            </span>
          )}
          <span className="inline-flex items-center gap-1 text-xs text-secondary">
            <Icon name="clock" size={12} />
            <DateTime iso={app.createdAt} />
          </span>
        </div>
        {app.status !== "withdrawn" && (
          <div className="flex flex-wrap items-center gap-1.5">
            {app.status === "submitted" && (
              <Button variant="secondary" size="small" disabled={busy} onClick={onShortlist}>
                Shortlist
              </Button>
            )}
            {app.status !== "accepted" && (
              <Button variant="primary" size="small" disabled={busy} onClick={onAccept}>
                <Icon name="check" size={14} />
                Accept
              </Button>
            )}
            {app.status !== "declined" && (
              <Button variant="ghost" size="small" className="text-error!" disabled={busy} onClick={onDecline}>
                Decline
              </Button>
            )}
            {(decided || app.status === "shortlisted") && (
              <Button variant="ghost" size="small" disabled={busy} onClick={onUndo}>
                Move back to New
              </Button>
            )}
          </div>
        )}
      </div>

      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex min-w-0 flex-col">
          <dt className="text-xs text-secondary">Email</dt>
          <dd className="truncate">{app.email ? <a href={`mailto:${app.email}`} className="text-ink hover:underline" dir="ltr">{app.email}</a> : <span className="text-disabled">—</span>}</dd>
        </div>
        <div className="flex min-w-0 flex-col">
          <dt className="text-xs text-secondary">Phone</dt>
          <dd>{app.phone ? <a href={`tel:${app.phone.replace(/[^+0-9]/g, "")}`} className="text-ink hover:underline" dir="ltr">{app.phone}</a> : <span className="text-disabled">—</span>}</dd>
        </div>
        <div className="flex min-w-0 flex-col">
          <dt className="text-xs text-secondary">Location</dt>
          <dd className="truncate text-ink">{app.location ?? <span className="text-disabled">—</span>}</dd>
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-xs text-secondary">Link and CV</dt>
          <dd className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {app.link && (
              <a href={app.link} target="_blank" rel="noreferrer nofollow" className="inline-flex max-w-full items-center gap-1 font-medium text-primary hover:underline" title={app.link}>
                <Icon name="link" size={14} className="shrink-0" />
                <span className="truncate" dir="ltr">{applyHost(app.link)}</span>
              </a>
            )}
            {app.cv && (
              <a href={`/opportunities/${listingId}/applications/cv/${app.cv.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline" title={app.cv.name}>
                <Icon name="file" size={14} className="shrink-0" />
                {t("CV (PDF, {size})", { size: formatBytes(app.cv.sizeBytes) })}
              </a>
            )}
            {!app.link && !app.cv && <span className="text-disabled">—</span>}
          </dd>
        </div>
      </dl>

      <div className="flex flex-col gap-1 rounded-lg bg-muted px-3 py-2">
        <span className="text-xs text-secondary">Note</span>
        <p className={cn("text-sm whitespace-pre-line text-body", !open && long && "line-clamp-3")} dir="auto">
          {app.note}
        </p>
        {long && (
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="self-start text-sm font-medium text-primary hover:underline">
            {open ? "Show less" : "Show the whole note"}
          </button>
        )}
      </div>
    </li>
  );
}
