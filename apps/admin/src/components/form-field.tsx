import { useId, type ComponentProps, type ReactNode } from "react";
import { Icon, cn } from "@chartermission/ui";

export const inputClasses = (invalid?: boolean, className?: string) =>
  cn(
    "w-full rounded-lg border bg-card px-3 py-2 text-sm text-ink outline-none placeholder:text-disabled focus:ring-2 focus:ring-primary-light/40",
    invalid ? "border-error" : "border-line-strong focus:border-primary-light",
    className,
  );

/** Labelled input with an optional hint and inline error (announced with role="alert"). */
export function TextField({
  label,
  hint,
  error,
  className,
  inputClassName,
  trailing,
  ...rest
}: ComponentProps<"input"> & {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  inputClassName?: string;
  /** Content inside the input's right edge, e.g. a show/hide button. */
  trailing?: ReactNode;
}) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-label text-ink">
        {label}
      </label>
      <span className="relative">
        <input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={inputClasses(!!error, cn(trailing ? "pr-16" : undefined, inputClassName))}
          {...rest}
        />
        {trailing && <span className="absolute inset-y-0 right-1.5 my-auto h-fit">{trailing}</span>}
      </span>
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

/** Banner for form-level messages. */
export function FormNotice({
  tone,
  children,
  className,
}: {
  tone: "error" | "info" | "success" | "warning";
  children: ReactNode;
  className?: string;
}) {
  const styles = {
    error: "bg-error-light text-error",
    info: "bg-info-light text-body",
    success: "bg-success-light text-body",
    warning: "bg-warning-light text-body",
  }[tone];
  const icon = tone === "success" ? "check" : tone === "info" ? "clock" : "alert";
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn("flex items-start gap-2 rounded-lg p-3 text-sm", styles, className)}
    >
      <Icon
        name={icon}
        size={16}
        className={cn(
          "mt-0.5 shrink-0",
          tone === "info" && "text-info",
          tone === "success" && "text-success",
          tone === "warning" && "text-warning",
        )}
      />
      <span>{children}</span>
    </p>
  );
}
