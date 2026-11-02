"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button, Icon, buttonClasses, cn } from "@chartermission/ui";

export const MIN_REASON_LENGTH = 10;

export type ConfirmTone = "primary" | "danger";

/**
 * Modal confirmation for any console action that changes what members see.
 * The reason is required: it is written to the audit log with the action.
 * Mount it only while an action is pending; it opens itself on mount.
 */
export function ReasonDialog({
  title,
  description,
  confirmLabel,
  tone = "primary",
  reasonLabel = "Reason",
  reasonPlaceholder = "Explain the decision for the audit log and any appeal reviewer",
  children,
  onConfirm,
  onClose,
}: {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  tone?: ConfirmTone;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  /** Extra fields (selects etc.) rendered above the reason. Read them from the FormData. */
  children?: ReactNode;
  onConfirm: (reason: string, data: FormData) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const reason = String(data.get("reason") ?? "").trim();
    if (reason.length < MIN_REASON_LENGTH) {
      setError(
        reason.length === 0
          ? "A reason is required. It is recorded in the audit log."
          : `Add a little more detail (at least ${MIN_REASON_LENGTH} characters).`,
      );
      reasonRef.current?.focus();
      return;
    }
    onConfirm(reason, data);
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-desc`}
      onClose={onClose}
      className="m-auto w-[460px] max-w-[calc(100vw-32px)] rounded-card border border-line bg-card p-0 text-ink shadow-[0_12px_40px_rgba(25,37,80,0.18)] backdrop:bg-primary-dark/40"
    >
      <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-4">
          <h2 id={`${id}-title`} className="text-h3 text-ink">
            {title}
          </h2>
          <button
            type="button"
            onClick={() => ref.current?.close()}
            className="-m-1 rounded-md p-1 text-secondary hover:bg-muted hover:text-ink"
          >
            <Icon name="x" size={18} label="Close" />
          </button>
        </div>
        <div id={`${id}-desc`} className="text-sm text-body">
          {description}
        </div>
        {children}
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-reason`} className="text-label text-ink">
            {reasonLabel} <span className="font-normal text-secondary">(required)</span>
          </label>
          <textarea
            ref={reasonRef}
            id={`${id}-reason`}
            name="reason"
            rows={3}
            required
            minLength={MIN_REASON_LENGTH}
            maxLength={500}
            placeholder={reasonPlaceholder}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : `${id}-hint`}
            onChange={() => error && setError(null)}
            className={cn(
              "w-full resize-y rounded-lg border bg-card px-3 py-2 text-sm text-ink outline-none placeholder:text-disabled focus:ring-2 focus:ring-primary-light/40",
              error ? "border-error" : "border-line-strong focus:border-primary-light",
            )}
          />
          {error ? (
            <p id={`${id}-error`} role="alert" className="flex items-center gap-1.5 text-xs text-error">
              <Icon name="alert" size={14} />
              {error}
            </p>
          ) : (
            <p id={`${id}-hint`} className="text-xs text-secondary">
              Recorded in the audit log with your name and the time.
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" size="small" onClick={() => ref.current?.close()}>
            Cancel
          </Button>
          <button
            type="submit"
            className={buttonClasses({
              variant: tone === "danger" ? "accent" : "primary",
              size: "small",
            })}
          >
            {confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}

/** Labelled native select used for extra fields inside a ReasonDialog. */
export function DialogSelect({
  label,
  name,
  options,
  defaultValue,
}: {
  label: string;
  name: string;
  options: readonly { value: string; label: string }[];
  defaultValue?: string;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-label text-ink">
        {label}
      </label>
      <span className="relative">
        <select
          id={id}
          name={name}
          defaultValue={defaultValue}
          className="w-full appearance-none rounded-lg border border-line-strong bg-card py-2 pr-9 pl-3 text-sm text-ink hover:border-secondary"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <Icon
          name="chevron-down"
          size={14}
          className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-secondary"
        />
      </span>
    </div>
  );
}
