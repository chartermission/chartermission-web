"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { CancelEventInput, SubmitForReviewInput, type EventDetail } from "@chartermission/contracts";
import { Button, Icon, Panel, buttonClasses, cn, type IconName } from "@chartermission/ui";
import { inputClasses } from "@/components/auth/fields";
import { ConfirmDialog } from "@/components/social/confirm-dialog";
import { Dialog, closeDialog } from "@/components/social/dialog";
import { ErrorNotice } from "@/components/social/errors";
import { toast } from "@/components/social/toast";
import { api } from "@/lib/api/client";
import { LifecycleChip } from "./event-meta";
import { canEditEvent } from "./rules";

const SUBMITTABLE = new Set<EventDetail["status"]>(["draft", "changes_requested", "rejected", "unpublished"]);

/** Status banner above the event for hosts: draft, in review, changes requested (with the note), rejected, unpublished. */
export function HostStatusBanner({ event, canPublishDirectly }: { event: EventDetail; canPublishDirectly: boolean }) {
  if (!event.viewer.canManage) return null;
  const note = event.review?.note;
  const banners: Partial<Record<EventDetail["status"], { tone: string; icon: IconName; title: string; text: string }>> = {
    draft: {
      tone: "border-line bg-muted",
      icon: "eye-off",
      title: "Draft — only you and co-hosts can see this",
      text: canPublishDirectly ? "Publish it when it’s ready and it goes live straight away." : "Submit it for review when it’s ready. The team checks events before they’re listed, usually within a day.",
    },
    pending_review: {
      tone: "border-info/30 bg-info-light",
      icon: "clock",
      title: "In review",
      text: "The Charter Mission team is checking this event. We’ll notify you when it’s approved or if anything needs changing.",
    },
    changes_requested: {
      tone: "border-warning/30 bg-warning-light",
      icon: "lightbulb",
      title: "Changes requested",
      text: "Update the event and submit it again.",
    },
    rejected: {
      tone: "border-error/30 bg-error-light",
      icon: "alert",
      title: "Not approved",
      text: "This event wasn’t approved for listing. You can edit it and submit again.",
    },
    unpublished: {
      tone: "border-line bg-muted",
      icon: "eye-off",
      title: "Unpublished",
      text: "This event is hidden from listings. Registrants keep their places. Submit it again to relist it.",
    },
  };
  const banner = banners[event.status];
  if (!banner) return null;
  return (
    <div role="status" className={cn("flex items-start gap-3 rounded-card border px-5 py-4", banner.tone)}>
      <Icon name={banner.icon} size={20} className="mt-0.5 shrink-0 text-ink" />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-md font-semibold text-ink">{banner.title}</p>
        <p className="text-sm text-body">{banner.text}</p>
        {note && (event.status === "changes_requested" || event.status === "rejected" || event.status === "unpublished") && (
          <blockquote className="mt-1 border-l-[3px] border-line-strong bg-card/70 py-2 pl-3 pr-3 text-sm text-ink">
            <span className="block text-label uppercase text-secondary">Note from the reviewer</span>
            {note}
          </blockquote>
        )}
      </div>
    </div>
  );
}

function SubmitDialog({ event, canPublishDirectly, onClose }: { event: EventDetail; canPublishDirectly: boolean; onClose: () => void }) {
  const router = useRouter();
  const id = useId();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(target: HTMLElement) {
    const parsed = SubmitForReviewInput.safeParse({ note: note.trim() || undefined });
    if (!parsed.success) return setError(new Error(parsed.error.issues[0]?.message ?? "Check the note"));
    setBusy(true);
    setError(null);
    try {
      const result = await api<EventDetail>(`/events/${event.id}/submit`, { method: "POST", body: parsed.data });
      toast.success(result.status === "published" ? "Published — your event is live" : "Submitted for review. We’ll notify you when it’s checked.");
      closeDialog(target);
      router.refresh();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={canPublishDirectly ? "Publish this event?" : "Submit for review?"}
      description={canPublishDirectly ? "It goes live on Events straight away." : "The team checks events before they appear in listings, usually within a day."}
      onClose={onClose}
      width={480}
      footer={
        <>
          <button type="button" className={buttonClasses({ variant: "secondary" })} onClick={(e) => closeDialog(e.currentTarget)}>
            Not yet
          </button>
          <Button onClick={(e) => void submit(e.currentTarget)} disabled={busy}>
            {busy ? "Working…" : canPublishDirectly ? "Publish" : "Submit for review"}
          </Button>
        </>
      }
    >
      {!canPublishDirectly && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-note`} className="text-sm font-medium text-ink">
            Note for the reviewer <span className="font-normal text-secondary">(optional)</span>
          </label>
          <textarea id={`${id}-note`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={3} className={inputClasses(false, "h-auto py-2.5")} placeholder="Anything the team should know, e.g. what you changed" />
        </div>
      )}
      <div aria-live="polite">{error ? <ErrorNotice error={error} /> : null}</div>
    </Dialog>
  );
}

function CancelEventDialog({ event, onClose }: { event: EventDetail; onClose: () => void }) {
  const router = useRouter();
  const id = useId();
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const people = event.registeredCount + event.waitlistCount;

  async function submit(target: HTMLElement) {
    const parsed = CancelEventInput.safeParse({ reason });
    if (!parsed.success) return setFieldError(parsed.error.issues[0]?.message ?? "Tell registrants why");
    setFieldError(null);
    setBusy(true);
    setError(null);
    try {
      await api<EventDetail>(`/events/${event.id}/cancel`, { method: "POST", body: parsed.data });
      toast.success("Event cancelled. Registrants have been notified.");
      closeDialog(target);
      router.refresh();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Dialog
      title="Cancel this event?"
      description={people ? `${people} registered and waitlisted ${people === 1 ? "member" : "members"} will be notified in the app and by email.` : "Nobody has registered yet."}
      onClose={onClose}
      width={480}
      footer={
        <>
          <button type="button" className={buttonClasses({ variant: "secondary" })} onClick={(e) => closeDialog(e.currentTarget)}>
            Keep event
          </button>
          <Button onClick={(e) => void submit(e.currentTarget)} disabled={busy} className="bg-error hover:bg-error/90">
            {busy ? "Cancelling…" : "Cancel event"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-reason`} className="text-sm font-medium text-ink">
          Reason
        </label>
        <textarea
          id={`${id}-reason`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          rows={3}
          aria-invalid={Boolean(fieldError) || undefined}
          aria-describedby={fieldError ? `${id}-reason-error` : `${id}-reason-hint`}
          className={inputClasses(Boolean(fieldError), "h-auto py-2.5")}
          placeholder="e.g. The speaker is unwell; we’ll announce a new date soon."
        />
        {fieldError ? (
          <p id={`${id}-reason-error`} className="flex items-center gap-1 text-xs text-error">
            <Icon name="alert" size={14} />
            {fieldError}
          </p>
        ) : (
          <p id={`${id}-reason-hint`} className="text-xs text-secondary">
            Shown on the event page and sent to registrants. This can’t be undone.
          </p>
        )}
      </div>
      <div aria-live="polite">{error ? <ErrorNotice error={error} /> : null}</div>
    </Dialog>
  );
}

/** "Manage event" panel for hosts: edit, submit/publish, registrations, cancel, delete draft. */
export function HostTools({ event, canPublishDirectly }: { event: EventDetail; canPublishDirectly: boolean }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"submit" | "cancel" | "delete" | null>(null);
  if (!event.viewer.canManage) return null;

  const editable = canEditEvent(event);
  const submittable = SUBMITTABLE.has(event.status) && !event.cancelledAt && !event.past;
  const cancellable = event.status === "published" && !event.cancelledAt && !event.past;
  const deletable = event.status === "draft" || (event.status === "rejected" && !event.review?.publishedAt);
  const hasRegistrations = event.registrationMode === "internal" && (event.status === "published" || event.status === "archived" || event.status === "unpublished");

  async function remove() {
    await api(`/events/${event.id}`, { method: "DELETE" });
    toast.success("Draft deleted");
    router.replace("/events/mine?role=hosting");
  }

  return (
    <Panel aria-labelledby="host-tools-heading" className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 id="host-tools-heading" className="text-h3 text-ink">
          Manage event
        </h2>
        {!event.cancelledAt && <LifecycleChip status={event.status} />}
      </div>
      <div className="flex flex-col gap-2">
        {submittable && (
          <Button block onClick={() => setDialog("submit")}>
            <Icon name={canPublishDirectly ? "send" : "check"} size={18} />
            {canPublishDirectly ? "Publish" : event.status === "draft" ? "Submit for review" : "Submit again"}
          </Button>
        )}
        <div className="flex gap-2 *:flex-1">
          {editable && (
            <Link href={`/events/${event.slug}/edit`} className={buttonClasses({ variant: "secondary", size: "small" })}>
              Edit
            </Link>
          )}
          {hasRegistrations && (
            <Link href={`/events/${event.slug}/registrations`} className={buttonClasses({ variant: "secondary", size: "small" })}>
              <Icon name="users" size={16} />
              Registrations
            </Link>
          )}
        </div>
        {(cancellable || deletable) && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
            {cancellable && (
              <button type="button" onClick={() => setDialog("cancel")} className="text-sm font-medium text-error hover:underline">
                Cancel event
              </button>
            )}
            {deletable && (
              <button type="button" onClick={() => setDialog("delete")} className="text-sm font-medium text-error hover:underline">
                Delete draft
              </button>
            )}
          </div>
        )}
        {event.status === "pending_review" && <p className="text-sm text-secondary">Editing is paused while the team reviews this event. You’ll be notified of the outcome.</p>}
        {event.status === "archived" && !event.past && <p className="text-sm text-secondary">This event has been archived.</p>}
        {!editable && !event.cancelledAt && event.past && <p className="text-xs text-secondary">Past events can’t be edited. Mark attendance from Registrations.</p>}
      </div>
      {dialog === "submit" && <SubmitDialog event={event} canPublishDirectly={canPublishDirectly} onClose={() => setDialog(null)} />}
      {dialog === "cancel" && <CancelEventDialog event={event} onClose={() => setDialog(null)} />}
      {dialog === "delete" && (
        <ConfirmDialog title="Delete this draft?" confirmLabel="Delete draft" danger onConfirm={remove} onClose={() => setDialog(null)}>
          The draft and everything in it are removed. This can’t be undone.
        </ConfirmDialog>
      )}
    </Panel>
  );
}
