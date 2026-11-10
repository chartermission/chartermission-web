"use client";

import { useEffect, useId, useRef, type FormEvent, type ReactNode } from "react";
import { Button, Icon, buttonClasses, cn } from "@chartermission/ui";

/**
 * Form modal for the Ambassadors section (same look as ReasonDialog). Mount it only while it should
 * be open; it opens itself. The parent closes it by unmounting (onClose fires on Esc / Cancel).
 */
export function FormModal({
  title,
  description,
  submitLabel,
  busy,
  error,
  wide,
  children,
  onSubmit,
  onClose,
}: {
  title: string;
  description?: ReactNode;
  submitLabel: string;
  busy: boolean;
  error?: string | null;
  wide?: boolean;
  children: ReactNode;
  onSubmit: (data: FormData) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!busy) onSubmit(new FormData(event.currentTarget));
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-title`}
      onClose={onClose}
      onCancel={(event) => {
        if (busy) event.preventDefault();
      }}
      className={cn(
        "m-auto max-h-[calc(100dvh-32px)] max-w-[calc(100vw-32px)] rounded-card border border-line bg-card p-0 text-ink shadow-[0_12px_40px_rgba(25,37,80,0.18)] backdrop:bg-primary-dark/40",
        wide ? "w-[680px]" : "w-[480px]",
      )}
    >
      <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 id={`${id}-title`} className="text-h3 text-ink">
              {title}
            </h2>
            {description && <div className="text-sm text-body">{description}</div>}
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
        {children}
        {error && (
          <p role="alert" className="flex items-start gap-2 rounded-lg bg-error-light p-3 text-sm text-error">
            <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" size="small" disabled={busy} onClick={() => ref.current?.close()}>
            Cancel
          </Button>
          <button type="submit" disabled={busy} aria-busy={busy} className={buttonClasses({ variant: "primary", size: "small" })}>
            {busy ? "Saving…" : submitLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}

/** Labelled select or textarea matching TextField. */
export function Field({ label, hint, error, children }: { label: ReactNode; hint?: ReactNode; error?: string | null; children: (id: string, describedBy?: string) => ReactNode }) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-label text-ink">
        {label}
      </label>
      {children(id, describedBy)}
      {error ? (
        <p id={`${id}-error`} role="alert" className="flex items-center gap-1.5 text-xs text-error">
          <Icon name="alert" size={14} />
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-secondary">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export const selectClasses = (invalid?: boolean) =>
  cn(
    "w-full appearance-none rounded-lg border bg-card py-2 pr-9 pl-3 text-sm text-ink outline-none focus:ring-2 focus:ring-primary-light/40",
    invalid ? "border-error" : "border-line-strong hover:border-secondary focus:border-primary-light",
  );

export function SelectBox({
  id,
  name,
  defaultValue,
  invalid,
  describedBy,
  options,
}: {
  id: string;
  name: string;
  defaultValue?: string;
  invalid?: boolean;
  describedBy?: string;
  options: readonly { value: string; label: string }[];
}) {
  return (
    <span className="relative">
      <select id={id} name={name} defaultValue={defaultValue} aria-invalid={invalid || undefined} aria-describedby={describedBy} className={selectClasses(invalid)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Icon name="chevron-down" size={14} className="pointer-events-none absolute inset-y-0 right-3 my-auto h-fit text-secondary" />
    </span>
  );
}
