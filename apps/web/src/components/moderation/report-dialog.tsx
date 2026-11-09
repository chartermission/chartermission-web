"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import {
  REPORT_REASON_LABELS,
  ReportReason,
  type CreateReportInput,
  type CreateReportResponse,
  type ReportTargetType,
} from "@chartermission/contracts";
import { Button, Icon, buttonClasses, cn } from "@chartermission/ui";
import { api } from "@/lib/api/client";
import { Dialog } from "@/components/social/dialog";
import { ErrorNotice } from "@/components/social/errors";

const DETAIL_MAX = 1000;

const targetNoun: Record<ReportTargetType, string> = {
  post: "post",
  comment: "comment",
  member: "member",
  hashtag: "hashtag",
  story: "story",
  opportunity: "listing",
};

/** Reasons offered per target: trend manipulation only makes sense for hashtags, impersonation for members. */
function reasonsFor(type: ReportTargetType): ReportReason[] {
  return ReportReason.options.filter((reason) => {
    if (reason === "trend_manipulation") return type === "hashtag";
    if (reason === "impersonation") return type === "member" || type === "post";
    return true;
  });
}

/**
 * Report a post, comment, member or hashtag (POST /reports). After sending, shows the
 * API's nextSteps so the reporter knows what happens next (spec 8.5).
 * Mount to open; onClose runs when dismissed.
 */
export function ReportDialog({
  targetType,
  targetId,
  subject,
  onClose,
}: {
  targetType: ReportTargetType;
  targetId: string;
  /** Shown in the description, e.g. "Amara Okafor's post" or "#AfCFTA". */
  subject: string;
  onClose: () => void;
}) {
  const id = useId();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateReportResponse | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!reason) {
      setFieldError("Choose a reason");
      formRef.current?.querySelector<HTMLInputElement>("input[type='radio']")?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body: CreateReportInput = { targetType, targetId, reason, detail: detail.trim() || undefined };
      const response = await api<CreateReportResponse>("/reports", { method: "POST", body });
      setResult(response);
      requestAnimationFrame(() => doneRef.current?.focus());
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const close = () => formRef.current?.closest("dialog")?.close() ?? doneRef.current?.closest("dialog")?.close();

  if (result) {
    return (
      <Dialog title="Thanks for reporting" onClose={onClose} width={480}>
        <div className="flex flex-col items-start gap-3" role="status">
          <span className="flex size-10 items-center justify-center rounded-full bg-success-light text-success">
            <Icon name="check" size={22} />
          </span>
          <p className="text-md text-ink">We received your report about {subject}.</p>
          <p className="text-sm text-body">{result.nextSteps}</p>
          <button
            ref={doneRef}
            type="button"
            onClick={(event) => event.currentTarget.closest("dialog")?.close()}
            className={buttonClasses({ className: "self-end" })}
          >
            Done
          </button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      title={`Report ${targetNoun[targetType]}`}
      description={<>Tell us what’s wrong with {subject}. Reports are confidential; the {targetType === "member" ? "member" : "author"} isn’t told who reported.</>}
      onClose={onClose}
      width={520}
    >
      <form ref={formRef} onSubmit={submit} noValidate className="flex flex-col gap-4">
        <fieldset aria-describedby={fieldError ? `${id}-reason-error` : undefined} className="flex flex-col gap-1">
          <legend className="mb-2 text-sm font-medium text-ink">Reason</legend>
          {reasonsFor(targetType).map((value) => (
            <label
              key={value}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors",
                reason === value ? "border-primary bg-primary-tint-2 text-ink" : "border-line text-body hover:border-line-strong",
              )}
            >
              <input
                type="radio"
                name={`${id}-reason`}
                value={value}
                checked={reason === value}
                onChange={() => {
                  setReason(value);
                  setFieldError(null);
                }}
                className="size-4 accent-primary"
              />
              {REPORT_REASON_LABELS[value]}
            </label>
          ))}
          {fieldError && (
            <p id={`${id}-reason-error`} role="alert" className="text-xs text-error">
              {fieldError}
            </p>
          )}
        </fieldset>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-detail`} className="text-sm font-medium text-ink">
            Details <span className="font-normal text-secondary">(optional)</span>
          </label>
          <textarea
            id={`${id}-detail`}
            value={detail}
            onChange={(event) => setDetail(event.target.value.slice(0, DETAIL_MAX))}
            rows={3}
            maxLength={DETAIL_MAX}
            aria-describedby={`${id}-detail-count`}
            placeholder="Anything that helps moderators understand the problem"
            className="w-full resize-y rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-none placeholder:text-disabled focus:border-primary-light focus:ring-2 focus:ring-primary-tint"
          />
          <p id={`${id}-detail-count`} className="self-end text-xs text-secondary">
            {detail.length} / {DETAIL_MAX}
          </p>
        </div>

        <div aria-live="polite">{error ? <ErrorNotice error={error} /> : null}</div>

        <div className="flex justify-end gap-2.5">
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Sending…" : "Send report"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
