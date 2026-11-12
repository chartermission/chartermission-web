"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ExamJoinStartInput, type ExamJoinInfo, type ExamJoinStarted, type ExamJoinVerified } from "@chartermission/contracts";
import { Avatar, Button, Icon, buttonClasses } from "@chartermission/ui";
import { api, isApiError } from "@/lib/api/client";
import { Checkbox, Field, FieldError, FormAlert, PasswordInput, describedBy, inputClasses, retryMessage, textLinkClasses } from "@/components/auth/fields";
import { PasswordRules, StrengthMeter, passwordRules } from "@/components/auth/password-rules";
import { NoTranslate } from "@/i18n/auto";
import { T, useT } from "@/i18n/client";

type Step = { name: "email" } | { name: "code"; started: ExamJoinStarted; email: string } | { name: "account"; started: ExamJoinStarted; verified: ExamJoinVerified };

const linkClasses = "underline decoration-line-strong underline-offset-2 hover:decoration-ink";

/** The message to show for a failed call, and the field it belongs to when the API named one. */
function problem(t: ReturnType<typeof useT>, error: unknown, field: string): { field?: string; form?: string } {
  if (isApiError(error, "RATE_LIMITED")) return { form: error.message || retryMessage(t, error.retryAfter) };
  if (isApiError(error) && error.fields?.[field]) return { field: error.fields[field] };
  if (isApiError(error) && error.fields && Object.values(error.fields)[0]) return { form: Object.values(error.fields)[0] };
  return { form: isApiError(error) ? error.message : "Something went wrong. Please try again." };
}

/**
 * Joining Charter Mission from a Charter Center exam invitation: the Charter Center email, the code
 * we email to it, then the name and photo Charter Center has for them and a password. The account
 * is made from those and the member lands on the exam, signed in.
 */
export function ExamJoinFlow({ exam }: { exam: ExamJoinInfo }) {
  const [step, setStep] = useState<Step>({ name: "email" });
  return (
    <div className="flex w-full flex-col gap-6">
      <ExamHeader exam={exam} />
      <ol aria-label="Steps" className="flex items-center gap-2 text-xs font-medium text-secondary">
        {["Your email", "Confirm", "Your account"].map((label, i) => {
          const current = (step.name === "email" ? 0 : step.name === "code" ? 1 : 2) === i;
          const done = (step.name === "email" ? 0 : step.name === "code" ? 1 : 2) > i;
          return (
            <li key={label} aria-current={current ? "step" : undefined} className="flex items-center gap-2">
              <span
                className={
                  done
                    ? "flex size-5 items-center justify-center rounded-full bg-success text-inverse"
                    : current
                      ? "flex size-5 items-center justify-center rounded-full bg-primary text-inverse"
                      : "flex size-5 items-center justify-center rounded-full bg-muted text-secondary"
                }
              >
                {done ? <Icon name="check" size={12} /> : i + 1}
              </span>
              <span className={current ? "text-ink" : undefined}>{label}</span>
              {i < 2 && <span aria-hidden="true" className="h-px w-4 bg-line-strong" />}
            </li>
          );
        })}
      </ol>
      {step.name === "email" && <EmailStep slug={exam.slug} onStarted={(started, email) => setStep({ name: "code", started, email })} />}
      {step.name === "code" && (
        <CodeStep
          started={step.started}
          email={step.email}
          onVerified={(verified) => setStep({ name: "account", started: step.started, verified })}
          onRestart={() => setStep({ name: "email" })}
        />
      )}
      {step.name === "account" &&
        (step.verified.status === "existing" ? (
          <ExistingAccount email={step.verified.email} slug={exam.slug} />
        ) : (
          <AccountStep joinId={step.started.joinId} verified={step.verified} onRestart={() => setStep({ name: "email" })} />
        ))}
    </div>
  );
}

function ExamHeader({ exam }: { exam: ExamJoinInfo }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-3">
      <span className="flex w-fit items-center gap-1.5 rounded-full bg-primary-tint-2 px-3 py-1 text-xs font-semibold text-primary-light">
        <Icon name="clipboard" size={14} />
        Charter Center exam
      </span>
      <h1 className="text-h1 text-ink max-sm:text-h2">
        <NoTranslate>
          <bdi>{exam.title}</bdi>
        </NoTranslate>
      </h1>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-secondary">
        <span>{t("{count} questions", { count: exam.questionCount })}</span>
        {exam.timeLimitMinutes && <span>{t("{count} minutes", { count: exam.timeLimitMinutes })}</span>}
        <span>{t("Pass mark {percent}%", { percent: exam.passPercent })}</span>
      </p>
      {exam.awardsCertificate && (
        <p className="flex items-start gap-2 rounded-[10px] bg-primary-tint-2 p-3 text-sm text-ink">
          <Icon name="verified" size={16} className="mt-0.5 shrink-0 text-primary-light" />
          Pass it to receive your Charter Center certificate.
        </p>
      )}
    </div>
  );
}

function EmailStep({ slug, onStarted }: { slug: string; onStarted: (started: ExamJoinStarted, email: string) => void }) {
  const t = useT();
  const id = useId();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setFormError(null);
    const parsed = ExamJoinStartInput.safeParse({ email });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter a valid email address");
      return;
    }
    setBusy(true);
    try {
      const started = await api<ExamJoinStarted>(`/exam-join/${encodeURIComponent(slug)}/start`, { body: parsed.data });
      onStarted(started, parsed.data.email);
    } catch (e) {
      const p = problem(t, e, "email");
      setError(p.field);
      setFormError(p.form ?? null);
      setBusy(false);
    }
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-[18px]">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-h3 text-ink">Start with your Charter Center email</h2>
        <p className="text-sm text-secondary">Use the email address you use on Charter Center. We’ll send a code to confirm it’s yours, then set up your Charter Mission account with your Charter Center name and photo.</p>
      </div>
      {formError && <FormAlert tone="error">{formError}</FormAlert>}
      <Field id={`${id}-email`} label="Charter Center email" error={error}>
        <input
          id={`${id}-email`}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          spellCheck={false}
          placeholder="you@example.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setError(undefined);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(error && `${id}-email-error`)}
          className={inputClasses(!!error)}
        />
      </Field>
      <Button type="submit" block disabled={busy} aria-busy={busy || undefined}>
        {busy ? "Checking with Charter Center…" : "Continue"}
      </Button>
      <p className="text-center text-sm text-secondary">
        Already on Charter Mission?{" "}
        <Link href={`/signin?next=${encodeURIComponent(`/exams/${slug}`)}`} className={textLinkClasses}>
          Sign in
        </Link>
      </p>
    </form>
  );
}

function CodeStep({
  started,
  email,
  onVerified,
  onRestart,
}: {
  started: ExamJoinStarted;
  email: string;
  onVerified: (verified: ExamJoinVerified) => void;
  onRestart: () => void;
}) {
  const t = useT();
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [current, setCurrent] = useState(started);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(started.resendAfter);

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  async function verify(value: string) {
    if (busy) return;
    if (!/^\d{6}$/.test(value)) {
      setError("Enter the 6-digit code");
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      onVerified(await api<ExamJoinVerified>("/exam-join/verify", { body: { joinId: current.joinId, code: value } }));
    } catch (e) {
      const p = problem(t, e, "code");
      setError(p.field);
      setFormError(p.form ?? null);
      setBusy(false);
    }
  }

  async function resend() {
    setNotice(null);
    setFormError(null);
    try {
      const next = await api<ExamJoinStarted>("/exam-join/resend", { body: { joinId: current.joinId } });
      setCurrent(next);
      setWait(next.resendAfter);
      setCode("");
      setError(undefined);
      setNotice("We sent a new code. The earlier one no longer works.");
    } catch (e) {
      setFormError(problem(t, e, "code").form ?? null);
    }
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void verify(code);
      }}
      className="flex flex-col gap-[18px]"
    >
      <div className="flex flex-col gap-1.5">
        <h2 className="text-h3 text-ink">Check your email</h2>
        <p className="text-sm text-secondary">
          <T vars={{ email: current.maskedEmail }}>{"We sent a 6-digit code to {email}. It works for 30 minutes."}</T>
        </p>
      </div>
      {formError && <FormAlert tone="error">{formError}</FormAlert>}
      {notice && <FormAlert tone="success">{notice}</FormAlert>}
      <Field id={`${id}-code`} label="Code" error={error}>
        <input
          ref={inputRef}
          id={`${id}-code`}
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          placeholder="123456"
          value={code}
          onChange={(e) => {
            const value = e.target.value.replace(/\D/g, "").slice(0, 6);
            setCode(value);
            setError(undefined);
            if (value.length === 6) void verify(value);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(error && `${id}-code-error`)}
          className={`${inputClasses(!!error)} text-center text-h3 tracking-[0.4em] tabular-nums`}
        />
      </Field>
      <Button type="submit" block disabled={busy} aria-busy={busy || undefined}>
        {busy ? "Checking…" : "Confirm"}
      </Button>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-secondary">
        {wait > 0 ? (
          <span aria-live="polite">{t("Send a new code in {count} seconds", { count: wait })}</span>
        ) : (
          <button type="button" onClick={() => void resend()} className={textLinkClasses}>
            Send a new code
          </button>
        )}
        <button type="button" onClick={onRestart} className={textLinkClasses}>
          Use a different email
        </button>
      </div>
      <p className="text-xs text-secondary">
        <T vars={{ email }}>{"Can’t find it? Check your spam folder for an email from Charter Mission to {email}."}</T>
      </p>
    </form>
  );
}

function AccountStep({ joinId, verified, onRestart }: { joinId: string; verified: Extract<ExamJoinVerified, { status: "new" }>; onRestart: () => void }) {
  const t = useT();
  const id = useId();
  const [password, setPassword] = useState("");
  const [accept, setAccept] = useState(false);
  const [errors, setErrors] = useState<{ password?: string; acceptTerms?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rules = passwordRules(password, { name: verified.name, email: verified.email });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setFormError(null);
    const next: typeof errors = {};
    if (password.length < 12) next.password = "Use at least 12 characters";
    else if (rules.some((r) => r.id === "personal" && !r.met)) next.password = "Don’t use your name or email address in your password";
    if (!accept) next.acceptTerms = "You must accept the terms to continue";
    setErrors(next);
    if (next.password || next.acceptTerms) return;
    setBusy(true);
    try {
      const done = await api<{ next: string }>("/exam-join/complete", { body: { joinId, password, acceptTerms: true } });
      // A full load, so every part of the site picks up the new session.
      window.location.assign(done.next);
    } catch (e) {
      if (isApiError(e) && e.fields?.password) setErrors({ password: e.fields.password });
      else setFormError(problem(t, e, "password").form ?? null);
      setBusy(false);
    }
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-[18px]">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-h3 text-ink">Is this you?</h2>
        <p className="text-sm text-secondary">This is how Charter Center knows you. Your Charter Mission profile starts with the same name and photo, and you can change them later.</p>
      </div>
      <div className="flex items-center gap-4 rounded-card border border-line bg-muted/40 p-4">
        <Avatar name={verified.name} src={verified.photo ?? undefined} size={56} tone="primary" />
        <div className="flex min-w-0 flex-col">
          <NoTranslate>
            <bdi className="truncate text-md font-semibold text-ink">{verified.name}</bdi>
            <bdi className="truncate text-sm text-secondary">{verified.email}</bdi>
          </NoTranslate>
        </div>
      </div>
      {formError && <FormAlert tone="error">{formError}</FormAlert>}
      <Field id={`${id}-password`} label="Choose a password" error={errors.password}>
        <PasswordInput
          id={`${id}-password`}
          name="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setErrors((x) => ({ ...x, password: undefined }));
          }}
          invalid={!!errors.password}
          aria-describedby={describedBy(`${id}-password-rules`, password.length >= 12 && `${id}-password-strength`, errors.password && `${id}-password-error`)}
        />
        <StrengthMeter id={`${id}-password-strength`} password={password} />
        <PasswordRules id={`${id}-password-rules`} rules={rules} />
      </Field>
      <div className="flex flex-col gap-2.5">
        <Checkbox
          name="acceptTerms"
          checked={accept}
          onChange={(e) => {
            setAccept(e.target.checked);
            setErrors((x) => ({ ...x, acceptTerms: undefined }));
          }}
          invalid={!!errors.acceptTerms}
          describedBy={describedBy(errors.acceptTerms && `${id}-terms-error`)}
        >
          <span className="text-ink">
            I agree to the{" "}
            <Link href="/terms" target="_blank" className={linkClasses}>
              Terms of Use
            </Link>
            ,{" "}
            <Link href="/privacy" target="_blank" className={linkClasses}>
              Privacy Notice
            </Link>{" "}
            and{" "}
            <Link href="/guidelines" target="_blank" className={linkClasses}>
              Community Guidelines
            </Link>
          </span>
        </Checkbox>
        <FieldError id={`${id}-terms-error`} message={errors.acceptTerms} />
      </div>
      <Button type="submit" block disabled={busy} aria-busy={busy || undefined}>
        {busy ? "Setting up your account…" : "Create account and start"}
      </Button>
      <p className="text-center text-sm text-secondary">
        Not you?{" "}
        <button type="button" onClick={onRestart} className={textLinkClasses}>
          Use a different email
        </button>
      </p>
    </form>
  );
}

function ExistingAccount({ email, slug }: { email: string; slug: string }) {
  return (
    <div className="flex flex-col gap-[18px]">
      <FormAlert tone="info" icon="user">
        <T vars={{ email }}>{"You already have a Charter Mission account with {email}. Sign in to take the exam."}</T>
      </FormAlert>
      <Link href={`/signin?next=${encodeURIComponent(`/exams/${slug}`)}`} className={buttonClasses({ variant: "primary", block: true })}>
        Sign in and take the exam
      </Link>
      <p className="text-center text-sm text-secondary">
        Forgot your password?{" "}
        <Link href="/forgot-password" className={textLinkClasses}>
          Reset it
        </Link>
      </p>
    </div>
  );
}
