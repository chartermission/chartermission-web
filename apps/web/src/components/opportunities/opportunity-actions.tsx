"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  APPLICATION_STATUS_LABELS,
  OPPORTUNITY_LIMITS,
  type OpportunityDetail,
} from "@chartermission/contracts";
import { Button, Chip, Icon, Panel, buttonClasses, cn } from "@chartermission/ui";
import { ReportDialog } from "@/components/moderation/report-dialog";
import { ConfirmDialog } from "@/components/social/confirm-dialog";
import { ErrorNotice } from "@/components/social/errors";
import { relativeTime } from "@/components/social/format";
import { toast } from "@/components/social/toast";
import { api, isApiError } from "@/lib/api/client";
import { SaveOpportunityButton, applicationTone } from "./opportunity-card";
import { T, useT, useIntlTag } from "@/i18n/client";

/**
 * The listing's action panel. Applicants: apply with a note, see their status, withdraw.
 * Poster: applicants link, edit, close or reopen, delete.
 */
export function OpportunityActions({ opportunity: initial }: { opportunity: OpportunityDetail }) {
  const intl = useIntlTag();
  const t = useT();
  const router = useRouter();
  const [o, setO] = useState(initial);
  const [note, setNote] = useState("");
  const [applying, setApplying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [modal, setModal] = useState<"withdraw" | "delete" | "report" | null>(null);
  const app = o.viewer.application;
  const activeApp = app && app.status !== "withdrawn" ? app : null;

  async function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = note.trim();
    if (trimmed.length < OPPORTUNITY_LIMITS.noteMin) {
      setNoteError(t("Tell the poster why you’re a fit in at least {noteMin} characters", { noteMin: OPPORTUNITY_LIMITS.noteMin }));
      document.getElementById("apply-note")?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setO(await api<OpportunityDetail>(`/opportunities/${o.id}/applications`, { method: "POST", body: { note: trimmed } }));
      setApplying(false);
      setNote("");
      toast.success("Application sent. The poster will see your profile and note.");
    } catch (e) {
      if (isApiError(e, "VALIDATION_FAILED") && e.fields?.note) setNoteError(e.fields.note);
      else setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function setOpen(open: boolean) {
    setBusy(true);
    try {
      setO(await api<OpportunityDetail>(`/opportunities/${o.id}/${open ? "reopen" : "close"}`, { method: "POST", body: {} }));
      toast.success(open ? "Listing reopened" : "Listing closed to new applications");
      router.refresh();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }

  if (o.viewer.isOwner) {
    return (
      <Panel className="flex flex-col gap-4 p-5">
        <h2 className="text-h3 text-ink">Your listing</h2>
        <p className="text-sm text-secondary">
          {o.applicationCount} {o.applicationCount === 1 ? "applicant" : "applicants"} · posted {relativeTime(intl, t, o.createdAt)}
        </p>
        {o.moderationState !== "visible" && (
          <p className="flex items-start gap-2 rounded-lg bg-error-light p-3 text-sm text-body">
            <Icon name="alert" size={16} className="mt-px shrink-0 text-error" />
            A moderator {o.moderationState === "removed" ? "removed" : "hid"} this listing, so members can’t see it. Check your account’s moderation page to appeal.
          </p>
        )}
        <Link href={`/opportunities/${o.slug}/applicants`} className={buttonClasses({ block: true })}>
          <Icon name="users" size={18} />
          Review applicants
        </Link>
        <div className="grid grid-cols-2 gap-2">
          <Link href={`/opportunities/${o.slug}/edit`} className={buttonClasses({ variant: "secondary", size: "small" })}>
            Edit
          </Link>
          <Button variant="secondary" size="small" aria-disabled={busy} onClick={() => setOpen(o.status !== "open")}>
            {o.status === "open" ? "Close" : "Reopen"}
          </Button>
        </div>
        <button type="button" onClick={() => setModal("delete")} className="self-start text-sm font-medium text-error hover:underline">
          Delete listing
        </button>
        {modal === "delete" && (
          <ConfirmDialog
            title="Delete this listing?"
            confirmLabel="Delete"
            danger
            onClose={() => setModal(null)}
            onConfirm={async () => {
              await api(`/opportunities/${o.id}`, { method: "DELETE" });
              toast.success("Listing deleted");
              router.push("/opportunities/mine");
            }}
          >
            Applicants will no longer see it. This can’t be undone.
          </ConfirmDialog>
        )}
      </Panel>
    );
  }

  return (
    <Panel className="flex flex-col gap-4 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-h3 text-ink">{activeApp ? "Your application" : "Apply"}</h2>
        <SaveOpportunityButton id={o.id} title={o.title} saved={o.viewer.saved} />
      </div>

      {activeApp ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={applicationTone[activeApp.status]}>{APPLICATION_STATUS_LABELS[activeApp.status]}</Chip>
            <span className="text-xs text-secondary"><T vars={{ time: relativeTime(intl, t, activeApp.createdAt) }}>{"Sent {time}"}</T></span>
          </div>
          <blockquote className="whitespace-pre-line rounded-lg bg-muted p-3 text-sm text-body">{activeApp.note}</blockquote>
          <p className="text-xs text-secondary">
            {activeApp.status === "accepted"
              ? "The poster accepted your application. Look out for a message from them about next steps."
              : activeApp.status === "declined"
                ? "The poster went with other applicants this time."
                : "The poster can see your profile and note. We’ll notify you when they make a decision."}
          </p>
          {(activeApp.status === "submitted" || activeApp.status === "shortlisted") && (
            <button type="button" onClick={() => setModal("withdraw")} className="self-start text-sm font-medium text-secondary hover:text-error hover:underline">
              Withdraw application
            </button>
          )}
        </>
      ) : o.viewer.canApply ? (
        applying ? (
          <form onSubmit={apply} noValidate className="flex flex-col gap-3">
            <label htmlFor="apply-note" className="text-sm font-medium text-ink">
              <T vars={{ name: o.poster.name }}>{"Note to {name}"}</T>
            </label>
            <textarea
              id="apply-note"
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                setNoteError(null);
              }}
              maxLength={OPPORTUNITY_LIMITS.note}
              rows={6}
              aria-invalid={!!noteError}
              aria-describedby="apply-note-help"
              placeholder="Why you’re a good fit, and anything they should know."
              className={cn(
                "w-full rounded-lg border bg-card px-3 py-2 text-sm text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-light",
                noteError ? "border-error" : "border-line",
              )}
            />
            <p id="apply-note-help" className={cn("text-xs", noteError ? "text-error" : "text-secondary")}>
              {noteError ?? t("Your profile goes with your note. {count} / {note}", { count: note.length, note: OPPORTUNITY_LIMITS.note })}
            </p>
            {error ? <ErrorNotice error={error} /> : null}
            <div className="flex gap-2">
              <Button type="submit" aria-disabled={busy}>
                {busy ? "Sending…" : "Send application"}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setApplying(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <>
            <p className="text-sm text-secondary"><T vars={{ name: o.poster.name }}>{"Apply with your Charter Mission profile and a short note. Only {name} sees your application."}</T></p>
            <Button block onClick={() => setApplying(true)}>
              {app?.status === "withdrawn" ? "Apply again" : "Apply now"}
            </Button>
          </>
        )
      ) : (
        <p className="flex items-start gap-2 text-sm text-secondary">
          <Icon name="alert" size={16} className="mt-px shrink-0" />
          {o.viewer.cannotApplyReason ?? "Applications are closed."}
        </p>
      )}

      {o.moreInfoUrl && (
        <a href={o.moreInfoUrl} target="_blank" rel="noopener noreferrer nofollow" className="flex items-center gap-1.5 text-sm font-medium text-primary-light hover:underline">
          More information
          <Icon name="external" size={14} />
        </a>
      )}
      {o.viewer.canReport && (
        <button type="button" onClick={() => setModal("report")} className="flex items-center gap-1.5 self-start text-xs text-secondary hover:text-ink hover:underline">
          <Icon name="flag" size={14} />
          Report this listing
        </button>
      )}

      {modal === "withdraw" && (
        <ConfirmDialog
          title="Withdraw your application?"
          confirmLabel="Withdraw"
          danger
          onClose={() => setModal(null)}
          onConfirm={async () => {
            setO(await api<OpportunityDetail>(`/opportunities/${o.id}/applications/mine`, { method: "DELETE" }));
            toast.success("Application withdrawn");
          }}
        >
          The poster will no longer see it. You can apply again while the listing is open.
        </ConfirmDialog>
      )}
      {modal === "report" && <ReportDialog targetType="opportunity" targetId={o.id} subject={`“${o.title}”`} onClose={() => setModal(null)} />}
    </Panel>
  );
}
