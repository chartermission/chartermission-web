"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { ResendVerificationInput } from "@chartermission/contracts";
import { Button, cn } from "@chartermission/ui";
import { api, isApiError } from "@/lib/api/client";
import { Field, FormAlert, describedBy, inputClasses, retryMessage } from "./fields";

const COOLDOWN_SECONDS = 30;

type Status = { tone: "success" | "error"; text: string } | null;

/**
 * POST /auth/resend. Signed-in members send nothing (the API uses the session); signed-out visitors
 * send the email, either known from the URL or typed in (`askEmail`). The response is identical
 * whether or not the account exists. Respects 429 with the API's retryAfter.
 */
export function ResendVerification({
  email: knownEmail,
  askEmail = false,
  label = "Resend email",
  variant = "secondary",
  size = "default",
  className,
  onSent,
}: {
  email?: string;
  askEmail?: boolean;
  label?: string;
  variant?: "primary" | "secondary" | "ghost";
  size?: "default" | "small";
  className?: string;
  onSent?: () => void;
}) {
  const id = useId();
  const [email, setEmail] = useState(knownEmail ?? "");
  const [emailError, setEmailError] = useState<string | undefined>();
  const [status, setStatus] = useState<Status>(null);
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function send(event?: FormEvent) {
    event?.preventDefault();
    if (sending || cooldown > 0) return;
    const body: ResendVerificationInput = {};
    if (askEmail || knownEmail) {
      const parsed = ResendVerificationInput.safeParse({ email });
      if (!parsed.success || !parsed.data.email) {
        setEmailError("Enter a valid email address");
        return;
      }
      body.email = parsed.data.email;
    }
    setEmailError(undefined);
    setSending(true);
    setStatus(null);
    try {
      await api("/auth/resend", { method: "POST", body });
      setStatus({
        tone: "success",
        text: body.email
          ? `If ${body.email} needs verifying, a new link is on its way. Links expire after 24 hours.`
          : "A new verification link is on its way. Links expire after 24 hours.",
      });
      setCooldown(COOLDOWN_SECONDS);
      onSent?.();
    } catch (error) {
      if (isApiError(error, "RATE_LIMITED")) {
        setStatus({ tone: "error", text: retryMessage(error.retryAfter, "You’ve asked for several links in the last hour.") });
        setCooldown(error.retryAfter && error.retryAfter < 3600 ? error.retryAfter : COOLDOWN_SECONDS);
      } else if (isApiError(error) && error.fields?.email) {
        setEmailError(error.fields.email);
      } else {
        setStatus({ tone: "error", text: isApiError(error) ? error.message : "Something went wrong. Please try again." });
      }
    } finally {
      setSending(false);
    }
  }

  const button = (
    <Button
      type={askEmail ? "submit" : "button"}
      variant={variant}
      size={size}
      onClick={askEmail ? undefined : () => void send()}
      disabled={sending || cooldown > 0}
      aria-busy={sending || undefined}
      className={cn(askEmail && "w-full")}
    >
      {sending ? "Sending…" : cooldown > 0 && status?.tone === "success" ? `Sent · resend in ${cooldown}s` : label}
    </Button>
  );

  if (askEmail) {
    return (
      <form noValidate onSubmit={send} className={cn("flex w-full flex-col gap-3", className)}>
        <Field id={`${id}-email`} label="Email" error={emailError}>
          <input
            id={`${id}-email`}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            spellCheck={false}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setEmailError(undefined);
            }}
            aria-invalid={emailError ? true : undefined}
            aria-describedby={describedBy(emailError && `${id}-email-error`)}
            className={inputClasses(!!emailError)}
          />
        </Field>
        {button}
        <div aria-live="polite">{status && <FormAlert tone={status.tone}>{status.text}</FormAlert>}</div>
      </form>
    );
  }

  return (
    <div className={cn("flex flex-col items-start gap-2", className)}>
      {button}
      <div aria-live="polite" className="w-full empty:hidden">
        {status && <p className={cn("text-sm", status.tone === "error" ? "text-error" : "text-success")}>{status.text}</p>}
      </div>
    </div>
  );
}
