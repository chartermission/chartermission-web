"use client";

import { useId } from "react";
import type { ContentCalendarAction, ContentCalendarActionResult, ContentCalendarKind } from "@chartermission/contracts";
import { ReasonDialog } from "@/components/reason-dialog";
import { inputClasses } from "@/components/form-field";
import { toast } from "@/components/toast";
import { ApiError, api } from "@/lib/api/client";
import { ACTION_LABELS, DANGER } from "./shared";

type Copy = { title: string; description: string; field: "required" | "optional"; done: string };

/** What each action says before it is confirmed, per kind of item. */
function copyFor(action: ContentCalendarAction, kind: ContentCalendarKind): Copy {
  switch (action) {
    case "hold":
      return {
        title: "Hold this scheduled post?",
        description: "It won’t be published until someone on the team releases it. The author is told, with your note.",
        field: "optional",
        done: "Post on hold. The author was told.",
      };
    case "release":
      return {
        title: "Release this post?",
        description: "It will be published at its scheduled time. If that time has passed, it goes out within a minute.",
        field: "optional",
        done: "Post released. It will be published at its time.",
      };
    case "reschedule":
      return {
        title: "Move this scheduled post?",
        description: "Pick a new date and time. The author is told about the change.",
        field: "optional",
        done: "Post moved. The author was told.",
      };
    case "cancel":
      return {
        title: "Cancel this scheduled post?",
        description: "It won’t be published. It goes back to the author’s drafts, and they are told, with your note.",
        field: "required",
        done: "Scheduled post cancelled. It is back in the author’s drafts.",
      };
    case "approve":
      return kind === "post"
        ? {
            title: "Approve this post?",
            description: "It goes live now. Followers and mentioned members are told, as with any new post.",
            field: "optional",
            done: "Post approved and published.",
          }
        : {
            title: "Approve this scheduled post?",
            description: "It will be published at its scheduled time. If that time has passed, it goes out within a minute.",
            field: "optional",
            done: "Scheduled post approved.",
          };
    case "decline":
      return kind === "post"
        ? {
            title: "Decline this post?",
            description: "It won’t be published. Only the author can still see it, with your note.",
            field: "required",
            done: "Post declined. The author was told.",
          }
        : {
            title: "Decline this scheduled post?",
            description: "It won’t be published. It goes back to the author’s drafts, with your note.",
            field: "required",
            done: "Scheduled post declined. The author was told.",
          };
    case "hide":
      return {
        title: "Hide this post?",
        description: "Members won’t see it. It appears in Hidden content, and the author is told and can appeal.",
        field: "required",
        done: "Post hidden.",
      };
    case "restore":
      return {
        title: "Restore this post?",
        description: "Members will see it again. The author is told.",
        field: "required",
        done: "Post restored.",
      };
  }
}

/** A date-time-local value ("2026-11-24T14:05") for an instant, in the viewer's zone. */
export function localInputValue(iso: string | null): string {
  const d = iso ? new Date(iso) : new Date(Date.now() + 3600_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The date and time field for rescheduling (viewer's zone). */
export function WhenField({ defaultValue }: { defaultValue: string }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-label text-ink">
        New date and time <span className="font-normal text-secondary">(your time zone)</span>
      </label>
      <input id={id} name="when" type="datetime-local" required defaultValue={defaultValue} className={inputClasses(false)} />
    </div>
  );
}

/** Parses the WhenField value as a future instant, or throws a message for the dialog. */
export function readWhen(data: FormData): string {
  const raw = String(data.get("when") ?? "");
  const at = raw ? new Date(raw) : null;
  if (!at || Number.isNaN(at.getTime())) throw new ApiError(422, "VALIDATION_FAILED", "Pick a date and time.");
  if (at.getTime() <= Date.now() + 60_000) throw new ApiError(422, "VALIDATION_FAILED", "Pick a time in the future.");
  return at.toISOString();
}

/** Confirms one action on one item and sends it. */
export function ActionDialog({
  kind,
  id,
  action,
  scheduledFor,
  onDone,
  onClose,
}: {
  kind: ContentCalendarKind;
  id: string;
  action: ContentCalendarAction;
  scheduledFor: string | null;
  onDone: (result: ContentCalendarActionResult) => void;
  onClose: () => void;
}) {
  const copy = copyFor(action, kind);
  const moderation = action === "hide" || action === "restore";
  return (
    <ReasonDialog
      title={copy.title}
      description={copy.description}
      confirmLabel={ACTION_LABELS[action]}
      tone={DANGER.has(action) ? "danger" : "primary"}
      reasonField={copy.field}
      reasonLabel={moderation ? "Reason" : "Note to the author"}
      reasonPlaceholder={moderation ? "Explain the decision for the audit log and any appeal reviewer" : "The author sees this in their notification and email"}
      minReasonLength={moderation ? 10 : 5}
      reasonHint={moderation ? "Recorded in the audit log with your name and the time." : "Sent to the author and kept in the audit log."}
      onConfirm={async (reason, data) => {
        const note = reason.trim() || undefined;
        const body = moderation
          ? { action, reason }
          : action === "reschedule"
            ? { action, scheduledFor: readWhen(data), note }
            : { action, note };
        const result = await api<ContentCalendarActionResult>(`/admin/content-calendar/${kind}/${id}/actions`, { method: "POST", body });
        toast(copy.done);
        onDone(result);
      }}
      onClose={onClose}
    >
      {action === "reschedule" && <WhenField defaultValue={localInputValue(scheduledFor)} />}
    </ReasonDialog>
  );
}
