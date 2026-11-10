"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { VERIFICATION_CATEGORY_LABELS, type AdminVerificationRow, type Page, type VerificationRequestStatus } from "@chartermission/contracts";
import { Avatar, Button, Chip, Icon, cn, type ChipTone } from "@chartermission/ui";
import { ReasonDialog } from "@/components/reason-dialog";
import { EmptyState } from "@/components/states";
import { DateTime, Relative } from "@/components/time";
import { toast } from "@/components/toast";
import { api, errorMessage } from "@/lib/api/client";
import { formatCount } from "@/lib/format";
import { webHref } from "@/lib/navigation";
import { useT } from "@/i18n/client";

type Filter = VerificationRequestStatus | "all";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "pending", label: "Waiting for review" },
  { value: "approved", label: "Approved" },
  { value: "declined", label: "Declined" },
  { value: "all", label: "All" },
];

const STATUS: Record<VerificationRequestStatus, { label: string; tone: ChipTone }> = {
  pending: { label: "Waiting for review", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  declined: { label: "Declined", tone: "error" },
};

function Fact({ label, value, warn = false }: { label: string; value: ReactNode; warn?: boolean }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-secondary">{label}</dt>
      <dd className={cn("text-sm font-medium tabular-nums", warn ? "text-error" : "text-ink")}>{value}</dd>
    </div>
  );
}

/** Verification requests (GET /admin/verification): oldest first while they wait, with what the reviewer needs to decide. */
export function VerificationConsole({ initial }: { initial: Page<AdminVerificationRow> }) {
  const t = useT();
  const [rows, setRows] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [filter, setFilter] = useState<Filter>("pending");
  const [loading, setLoading] = useState(false);
  const [deciding, setDeciding] = useState<{ row: AdminVerificationRow; decision: "approve" | "decline" } | null>(null);
  const first = useRef(true);

  async function load(status: Filter, from?: string | null) {
    setLoading(true);
    try {
      const page = await api<Page<AdminVerificationRow>>("/admin/verification", { query: { status, cursor: from ?? undefined } });
      setRows((list) => (from ? [...list, ...page.items.filter((r) => !list.some((x) => x.id === r.id))] : page.items));
      setCursor(page.nextCursor);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    void load(filter);
  }, [filter]);

  return (
    <section className="flex flex-col gap-4">
      <div role="tablist" aria-label="Filter requests" className="flex flex-wrap gap-1.5">
        {FILTERS.map((item) => (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={filter === item.value}
            onClick={() => setFilter(item.value)}
            className={cn("rounded-full border px-3 py-1.5 text-sm font-medium", filter === item.value ? "border-primary bg-primary text-inverse" : "border-line bg-card text-body hover:bg-muted")}
          >
            {item.label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-card border border-line bg-card">
          <EmptyState icon="verified" title={filter === "pending" ? "No requests waiting" : "Nothing here"} />
        </div>
      ) : (
        <ul className={cn("flex flex-col gap-3", loading && "opacity-70")} aria-busy={loading}>
          {rows.map((row) => {
            const subject = row.page ? row.page.name : row.applicant.name;
            const subjectHref = row.page ? webHref(`/pages/${row.page.slug}`) : webHref(`/${row.applicant.handle}`);
            return (
              <li key={row.id} className="flex flex-col gap-4 rounded-card border border-line bg-card p-5">
                <div className="flex flex-wrap items-start gap-3">
                  <Avatar name={row.applicant.name} src={row.applicant.avatarUrl ?? undefined} tone={row.applicant.tone} size={40} />
                  <div className="flex min-w-[240px] flex-1 flex-col gap-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <a href={subjectHref} target="_blank" rel="noreferrer" className="text-md font-semibold text-ink hover:underline">
                        {subject}
                      </a>
                      <Chip tone="neutral" className="px-2! py-0.5! text-xs!">
                        {row.page ? "Page" : "Member"}
                      </Chip>
                      <Chip tone={STATUS[row.status].tone} className="px-2! py-0.5! text-xs!">
                        {STATUS[row.status].label}
                      </Chip>
                    </div>
                    <p className="text-sm text-secondary">
                      {row.page ? (
                        <>
                          Requested by{" "}
                          <a href={webHref(`/${row.applicant.handle}`)} target="_blank" rel="noreferrer" className="font-medium text-ink hover:underline">
                            {row.applicant.name}
                          </a>{" "}
                          ·{" "}
                        </>
                      ) : null}
                      {row.applicant.email} · sent <Relative iso={row.createdAt} />
                    </p>
                  </div>
                  {row.status === "pending" && (
                    <div className="flex gap-2">
                      <Button size="small" onClick={() => setDeciding({ row, decision: "approve" })}>
                        Approve
                      </Button>
                      <Button variant="secondary" size="small" onClick={() => setDeciding({ row, decision: "decline" })}>
                        Decline
                      </Button>
                    </div>
                  )}
                </div>

                <div className="grid gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                  <div className="flex flex-col gap-3">
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                      <dt className="text-secondary">Applying as</dt>
                      <dd className="text-ink">{VERIFICATION_CATEGORY_LABELS[row.category]}</dd>
                      <dt className="text-secondary">{row.page ? "Registered name" : "Legal name"}</dt>
                      <dd className="font-medium text-ink">{row.legalName}</dd>
                    </dl>
                    <p className="rounded-lg bg-surface px-3 py-2.5 text-sm whitespace-pre-line text-body">{row.statement}</p>
                    <ul className="flex flex-col gap-1">
                      {row.links.map((link) => (
                        <li key={link} className="flex items-center gap-1.5 text-sm">
                          <Icon name="link" size={14} className="shrink-0 text-secondary" />
                          <a href={link} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-primary-light hover:underline">
                            {link}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <dl className="grid h-fit grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-line px-4 py-3">
                    <Fact label={row.page ? "Page created" : "Joined"} value={<DateTime iso={row.facts.joinedAt} dateOnly />} />
                    <Fact label="Followers" value={formatCount(row.facts.followers)} />
                    <Fact label="Posts" value={formatCount(row.facts.posts)} />
                    {!row.page && <Fact label="Connections" value={formatCount(row.facts.connections)} />}
                    <Fact label="Two-step sign-in" value={row.facts.twoStep ? "On" : "Off"} />
                    <Fact label="Open reports" value={formatCount(row.facts.openReports)} warn={row.facts.openReports > 0} />
                  </dl>
                </div>

                {row.status !== "pending" && (
                  <p className="border-t border-line pt-3 text-sm text-secondary">
                    {row.status === "approved" ? "Approved" : "Declined"}
                    {row.decidedBy ? ` by ${row.decidedBy}` : ""}
                    {row.decidedAt ? (
                      <>
                        {" "}
                        on <DateTime iso={row.decidedAt} dateOnly />
                      </>
                    ) : null}
                    {row.decisionNote ? `: “${row.decisionNote}”` : "."}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {cursor && (
        <Button variant="secondary" size="small" className="self-center" disabled={loading} onClick={() => void load(filter, cursor)}>
          Load more
        </Button>
      )}

      {deciding && (
        <ReasonDialog
          title={deciding.decision === "approve" ? t("Verify {count}?", { count: deciding.row.page?.name ?? deciding.row.applicant.name }) : t("Decline the request from {count}?", { count: deciding.row.page?.name ?? deciding.row.applicant.name })}
          description={
            deciding.decision === "approve"
              ? "The verified tick appears beside the name everywhere, and the applicant is told."
              : "The applicant sees your note and can apply again in 30 days."
          }
          confirmLabel={deciding.decision === "approve" ? "Approve and verify" : "Decline request"}
          tone={deciding.decision === "approve" ? "primary" : "danger"}
          reasonField={deciding.decision === "approve" ? "optional" : "required"}
          reasonLabel="Note to the applicant"
          reasonPlaceholder={deciding.decision === "approve" ? "Optional" : "What was missing or didn’t match"}
          reasonHint="Shown to the applicant and recorded in the audit log."
          requiredMessage="Add a note so the applicant knows what to change."
          minReasonLength={5}
          onClose={() => setDeciding(null)}
          onConfirm={async (note) => {
            const { row, decision } = deciding;
            const updated = await api<AdminVerificationRow>(`/admin/verification/${row.id}/decision`, { method: "POST", body: { decision, note: note || undefined } });
            setRows((list) => (filter === "pending" ? list.filter((r) => r.id !== row.id) : list.map((r) => (r.id === row.id ? updated : r))));
            toast(decision === "approve" ? t("{count} is verified.", { count: row.page?.name ?? row.applicant.name }) : "Request declined. The applicant has been told.");
            setDeciding(null);
          }}
        />
      )}
    </section>
  );
}
