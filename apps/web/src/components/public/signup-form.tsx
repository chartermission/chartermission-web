"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { SignUpInput } from "@chartermission/contracts";
import { Button, Icon, cn } from "@chartermission/ui";

type FieldName = keyof SignUpInput;
type Values = { name: string; email: string; password: string; country: string; acceptTerms: boolean };
type Errors = Partial<Record<FieldName, string>>;

const fieldOrder: FieldName[] = ["name", "email", "password", "country", "acceptTerms"];

const initialValues: Values = { name: "", email: "", password: "", country: "", acceptTerms: false };

/** Runs the shared SignUpInput schema and returns the first message per field. */
function validate(values: Values): Errors {
  const result = SignUpInput.safeParse(values);
  if (result.success) return {};
  const errors: Errors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0] as FieldName;
    if (errors[field]) continue;
    errors[field] = field === "name" && issue.code === "too_big" ? "Use 80 characters or fewer" : issue.message;
  }
  return errors;
}

/** 0–4 strength score for the meter (Figma shows 3 of 4 bars = "Strong password"). */
function passwordStrength(password: string): { score: number; label: string; tone: "error" | "warning" | "success" } {
  if (password.length < 12) return { score: 1, label: "Too short", tone: "error" };
  let score = 2;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password) || password.length >= 16) score += 1;
  if (score === 2) return { score, label: "Fair password", tone: "warning" };
  if (score === 3) return { score, label: "Strong password", tone: "success" };
  return { score, label: "Very strong password", tone: "success" };
}

const toneBar = { error: "bg-error", warning: "bg-warning", success: "bg-success" } as const;
const toneText = { error: "text-error", warning: "text-warning", success: "text-success" } as const;

const boxClasses = (invalid: boolean) =>
  cn(
    "h-11 w-full rounded-lg border bg-card text-sm transition-colors",
    invalid ? "border-error" : "border-line hover:border-line-strong",
  );

/** Input focus: 1.5px primary border as in the Figma focused field (17:1557). */
const focusRing = (invalid: boolean) =>
  cn("focus-visible:outline-none focus:ring-[0.5px]", invalid ? "focus:ring-error" : "focus:border-primary focus:ring-primary");

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="flex items-center gap-1 text-xs text-error">
      <Icon name="alert" size={14} className="shrink-0" />
      {message}
    </p>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex w-full flex-col gap-1.5">
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

function Checkbox({
  name,
  checked,
  onChange,
  onBlur,
  invalid,
  describedBy,
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
    <label className="flex cursor-pointer items-center gap-2.5 text-sm">
      <span className="grid size-4 shrink-0 place-items-center">
        <input
          type="checkbox"
          name={name}
          checked={checked}
          onChange={onChange}
          onBlur={onBlur}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={cn(
            "peer col-start-1 row-start-1 size-4 cursor-pointer appearance-none rounded border bg-card transition-colors",
            "checked:border-primary checked:bg-primary",
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

export function SignUpForm({ countryGroups }: { countryGroups: { label: string; countries: string[] }[] }) {
  const id = useId();
  const fieldId = (field: string) => `${id}-${field}`;

  const [values, setValues] = useState<Values>(initialValues);
  const [digest, setDigest] = useState(false);
  const [touched, setTouched] = useState<Partial<Record<FieldName, boolean>>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);

  const successHeading = useRef<HTMLHeadingElement>(null);

  const errors = validate(values);
  const visibleError = (field: FieldName) => (touched[field] || submitAttempted ? errors[field] : undefined);
  const strength = values.password ? passwordStrength(values.password) : null;

  useEffect(() => {
    if (submittedEmail) successHeading.current?.focus();
  }, [submittedEmail]);

  const update = <K extends keyof Values>(field: K, value: Values[K]) => setValues((prev) => ({ ...prev, [field]: value }));
  const touch = (field: FieldName) => setTouched((prev) => (prev[field] ? prev : { ...prev, [field]: true }));
  const describedBy = (field: FieldName, ...extra: (string | false)[]) =>
    [...extra, visibleError(field) && `${fieldId(field)}-error`].filter(Boolean).join(" ") || undefined;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitAttempted(true);
    const firstInvalid = fieldOrder.find((field) => errors[field]);
    if (firstInvalid) {
      const control = event.currentTarget.elements.namedItem(firstInvalid);
      if (control instanceof HTMLElement) control.focus();
      return;
    }
    // No API yet: the parsed SignUpInput (plus the digest opt-in) would be POSTed here.
    setSubmittedEmail(values.email.trim());
  }

  if (submittedEmail) {
    return (
      <div className="flex w-full max-w-[420px] flex-col items-start gap-[18px]">
        <span className="flex size-12 items-center justify-center rounded-full bg-info-light text-info">
          <Icon name="mail" size={24} />
        </span>
        <div className="flex flex-col gap-1.5">
          <h1 ref={successHeading} tabIndex={-1} className="text-h1 text-ink focus-visible:outline-none">
            Verify your email
          </h1>
          <p className="text-md text-secondary">
            Your account details look good. A verification link would be sent to{" "}
            <strong className="font-medium text-ink">{submittedEmail}</strong>. Once it’s verified you can post,
            comment and apply.
          </p>
        </div>
        <p className="flex w-full items-start gap-2 rounded-lg bg-warning-light p-3 text-xs text-body">
          <Icon name="alert" size={16} className="shrink-0 text-warning" />
          Preview build: sign-up isn’t connected to the server yet, so no email has actually been sent.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => setSubmittedEmail(null)}>
            Use a different email
          </Button>
          <Link
            href="/"
            className="inline-flex items-center px-1 py-2.5 text-md font-medium text-primary-light hover:underline"
          >
            Back to home
          </Link>
        </div>
      </div>
    );
  }

  const nameError = visibleError("name");
  const emailError = visibleError("email");
  const passwordError = visibleError("password");
  const countryError = visibleError("country");
  const termsError = visibleError("acceptTerms");

  return (
    <form
      noValidate
      onSubmit={handleSubmit}
      aria-labelledby={`${id}-title`}
      className="flex w-full max-w-[420px] flex-col gap-[18px]"
    >
      <div className="flex flex-col gap-1.5">
        <h1 id={`${id}-title`} className="text-h1 text-ink">
          Create your account
        </h1>
        <p className="text-md text-secondary">It takes two minutes. You can finish your profile later.</p>
      </div>

      <Field id={fieldId("name")} label="Full name" error={nameError}>
        <input
          id={fieldId("name")}
          name="name"
          type="text"
          autoComplete="name"
          placeholder="e.g. Amina Okafor"
          value={values.name}
          onChange={(e) => update("name", e.target.value)}
          onBlur={() => touch("name")}
          aria-invalid={nameError ? true : undefined}
          aria-describedby={describedBy("name")}
          className={cn(boxClasses(!!nameError), focusRing(!!nameError), "px-3.5 text-ink placeholder:text-disabled")}
        />
      </Field>

      <Field id={fieldId("email")} label="Email" error={emailError}>
        <input
          id={fieldId("email")}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          spellCheck={false}
          placeholder="you@example.com"
          value={values.email}
          onChange={(e) => update("email", e.target.value)}
          onBlur={() => touch("email")}
          aria-invalid={emailError ? true : undefined}
          aria-describedby={describedBy("email")}
          className={cn(boxClasses(!!emailError), focusRing(!!emailError), "px-3.5 text-ink placeholder:text-disabled")}
        />
      </Field>

      <Field
        id={fieldId("password")}
        label="Password"
        error={passwordError}
        hint={
          <span id={`${fieldId("password")}-hint`} className="text-xs text-secondary">
            At least 12 characters
          </span>
        }
      >
        <div
          className={cn(
            boxClasses(!!passwordError),
            "flex items-center gap-2 pr-1.5 pl-3.5 focus-within:ring-[0.5px]",
            passwordError ? "focus-within:ring-error" : "focus-within:border-primary focus-within:ring-primary",
          )}
        >
          <input
            id={fieldId("password")}
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            value={values.password}
            onChange={(e) => update("password", e.target.value)}
            onBlur={() => touch("password")}
            aria-invalid={passwordError ? true : undefined}
            aria-describedby={describedBy(
              "password",
              `${fieldId("password")}-hint`,
              !!strength && `${fieldId("password")}-strength`,
            )}
            className="h-full min-w-0 flex-1 bg-transparent text-ink focus-visible:outline-none"
          />
          <button
            type="button"
            onClick={() => setShowPassword((shown) => !shown)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-controls={fieldId("password")}
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-secondary hover:bg-muted hover:text-ink"
          >
            <Icon name={showPassword ? "eye-off" : "eye"} size={18} />
          </button>
        </div>
        {strength && (
          <>
            <div className="flex gap-1" aria-hidden="true">
              {[1, 2, 3, 4].map((bar) => (
                <span
                  key={bar}
                  className={cn("h-1 flex-1 rounded-[2px]", bar <= strength.score ? toneBar[strength.tone] : "bg-muted")}
                />
              ))}
            </div>
            <p id={`${fieldId("password")}-strength`} aria-live="polite" className={cn("text-xs", toneText[strength.tone])}>
              {strength.label}
            </p>
          </>
        )}
      </Field>

      <Field id={fieldId("country")} label="Country of residence" error={countryError}>
        <div className="relative">
          <select
            id={fieldId("country")}
            name="country"
            autoComplete="country-name"
            value={values.country}
            onChange={(e) => {
              update("country", e.target.value);
              touch("country");
            }}
            onBlur={() => touch("country")}
            aria-invalid={countryError ? true : undefined}
            aria-describedby={describedBy("country")}
            className={cn(
              boxClasses(!!countryError),
              focusRing(!!countryError),
              "cursor-pointer appearance-none pr-10 pl-3.5",
              values.country ? "text-ink" : "text-disabled",
            )}
          >
            <option value="" disabled>
              Select a country
            </option>
            {countryGroups.map((group) => (
              <optgroup key={group.label} label={group.label} className="text-ink">
                {group.countries.map((country) => (
                  <option key={country} value={country}>
                    {country}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {/* Decorative chevron over the native select (pointer-events disabled). */}
          <Icon
            name="chevron-down"
            size={18}
            className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-secondary"
          />
        </div>
      </Field>

      <div className="flex flex-col gap-2.5">
        <Checkbox
          name="acceptTerms"
          checked={values.acceptTerms}
          onChange={(e) => {
            update("acceptTerms", e.target.checked);
            touch("acceptTerms");
          }}
          invalid={!!termsError}
          describedBy={describedBy("acceptTerms")}
        >
          <span className="text-ink">
            I agree to the{" "}
            <Link href="/terms" className="underline decoration-line-strong underline-offset-2 hover:decoration-ink">
              Terms of Use
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="underline decoration-line-strong underline-offset-2 hover:decoration-ink">
              Privacy Notice
            </Link>
          </span>
        </Checkbox>
        <FieldError id={`${fieldId("acceptTerms")}-error`} message={termsError} />
        <Checkbox name="digest" checked={digest} onChange={(e) => setDigest(e.target.checked)}>
          <span className="text-body">Email me a weekly digest of opportunities (optional)</span>
        </Checkbox>
      </div>

      <Button type="submit" block>
        Create account
      </Button>

      <p className="text-center text-sm text-secondary">
        Already a member?{" "}
        <Link href="/signin" className="font-medium text-primary-light hover:underline">
          Sign in
        </Link>
      </p>

      <p className="flex items-center gap-2 rounded-lg bg-info-light p-3 text-xs text-body">
        <Icon name="mail" size={16} className="shrink-0 text-info" />
        We’ll send a verification link. You can post once your email is verified.
      </p>
    </form>
  );
}
