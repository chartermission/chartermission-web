"use client";

import { useState, type ChangeEvent, type InputHTMLAttributes, type ReactNode } from "react";
import { Icon, cn, type IconName } from "@chartermission/ui";

export const boxClasses = (invalid: boolean) =>
  cn(
    "h-11 w-full rounded-lg border bg-card text-sm transition-colors",
    invalid ? "border-error" : "border-line hover:border-line-strong",
  );

/** Input focus: 1.5px primary border as in the Figma focused field (17:1557). */
export const focusRing = (invalid: boolean) =>
  cn("focus-visible:outline-none focus:ring-[0.5px]", invalid ? "focus:ring-error" : "focus:border-primary focus:ring-primary");

export const inputClasses = (invalid: boolean, className?: string) =>
  cn(boxClasses(invalid), focusRing(invalid), "px-3.5 text-ink placeholder:text-disabled", className);

export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="flex items-center gap-1 text-xs text-error">
      <Icon name="alert" size={14} className="shrink-0" />
      {message}
    </p>
  );
}

export function Field({
  id,
  label,
  hint,
  error,
  children,
  className,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex w-full flex-col gap-1.5", className)}>
      <div className="flex items-start justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium text-ink">
          {label}
        </label>
        {hint}
      </div>
      {children}
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

/** Joins the ids that describe a control, skipping empty ones. */
export function describedBy(...ids: (string | false | null | undefined)[]) {
  return ids.filter(Boolean).join(" ") || undefined;
}

/** Password input with a show/hide toggle, sized like the other auth inputs. */
export function PasswordInput({
  id,
  invalid,
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { id: string; invalid: boolean }) {
  const [shown, setShown] = useState(false);
  return (
    <div
      className={cn(
        boxClasses(invalid),
        "flex items-center gap-2 pe-1.5 ps-3.5 focus-within:ring-[0.5px]",
        invalid ? "focus-within:ring-error" : "focus-within:border-primary focus-within:ring-primary",
        className,
      )}
    >
      <input
        id={id}
        type={shown ? "text" : "password"}
        aria-invalid={invalid || undefined}
        className="h-full min-w-0 flex-1 bg-transparent text-ink focus-visible:outline-none"
        {...rest}
      />
      <button
        type="button"
        onClick={() => setShown((value) => !value)}
        aria-label={shown ? "Hide password" : "Show password"}
        aria-controls={id}
        className="flex size-8 shrink-0 items-center justify-center rounded-md text-secondary hover:bg-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-primary-light"
      >
        <Icon name={shown ? "eye-off" : "eye"} size={18} />
      </button>
    </div>
  );
}

export function Checkbox({
  name,
  checked,
  onChange,
  onBlur,
  invalid,
  describedBy: described,
  children,
}: {
  name: string;
  checked: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onBlur?: () => void;
  invalid?: boolean;
  describedBy?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 text-sm">
      <span className="mt-px grid size-4 shrink-0 place-items-center">
        <input
          type="checkbox"
          name={name}
          checked={checked}
          onChange={onChange}
          onBlur={onBlur}
          aria-invalid={invalid || undefined}
          aria-describedby={described}
          className={cn(
            "peer col-start-1 row-start-1 size-4 cursor-pointer appearance-none rounded border bg-card transition-colors",
            "checked:border-primary checked:bg-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-light",
            invalid ? "border-error" : "border-line-strong",
          )}
        />
        <Icon
          name="check"
          size={12}
          className="pointer-events-none col-start-1 row-start-1 text-inverse opacity-0 peer-checked:opacity-100"
        />
      </span>
      {children}
    </label>
  );
}

type AlertTone = "error" | "info" | "success" | "warning";

const alertTone: Record<AlertTone, { box: string; icon: IconName; iconClass: string }> = {
  error: { box: "bg-error-light", icon: "alert", iconClass: "text-error" },
  info: { box: "bg-info-light", icon: "mail", iconClass: "text-info" },
  success: { box: "bg-success-light", icon: "check", iconClass: "text-success" },
  warning: { box: "bg-warning-light", icon: "alert", iconClass: "text-warning" },
};

/** Inline message box for form-level status. Errors are announced assertively. */
export function FormAlert({
  tone,
  children,
  className,
  icon,
}: {
  tone: AlertTone;
  children: ReactNode;
  className?: string;
  icon?: IconName;
}) {
  const meta = alertTone[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("flex w-full items-start gap-2 rounded-lg p-3 text-sm text-body", meta.box, className)}
    >
      <Icon name={icon ?? meta.icon} size={16} className={cn("mt-px shrink-0", meta.iconClass)} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** "Try again in N minutes" from a 429's retryAfter (seconds). */
export function retryMessage(retryAfter?: number, prefix = "Too many attempts.") {
  if (!retryAfter || retryAfter <= 0) return `${prefix} Try again later.`;
  if (retryAfter < 60) return `${prefix} Try again in ${retryAfter} second${retryAfter === 1 ? "" : "s"}.`;
  const minutes = Math.ceil(retryAfter / 60);
  return `${prefix} Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

export const textLinkClasses = "font-medium text-primary-light underline-offset-2 hover:underline";
