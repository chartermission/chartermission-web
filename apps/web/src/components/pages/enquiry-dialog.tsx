"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ENQUIRY_MAX, ENQUIRY_MIN, EnquiryInput, type EnquiryView, type PageRef, type SessionUser } from "@chartermission/contracts";
import { Button, Icon, buttonClasses, cn } from "@chartermission/ui";
import { FieldError, inputClasses } from "@/components/auth/fields";
import { closeDialog, Dialog } from "@/components/social/dialog";
import { ErrorNotice, VerifyEmailPrompt } from "@/components/social/errors";
import { api, isApiError } from "@/lib/api/client";
import { NoTranslate } from "@/i18n/auto";
import { T, usePathname, useT } from "@/i18n/client";

type About = { type: "product" | "service"; id: string; title: string };

/**
 * A button that opens the enquiry dialog for a page: a message to the page's team, optionally
 * about one of its products or services. Replies arrive in Messages.
 */
export function EnquiryButton({ page, about, label }: { page: PageRef; about?: About | null; label?: string }) {
  const t = useT();
  const [opened, setOpened] = useState(0);
  return (
    <>
      <Button
        variant="secondary"
        size={about ? "small" : "default"}
        onClick={() => setOpened((n) => n + 1)}
        aria-haspopup="dialog"
        aria-label={about && !label ? t("Enquire about {title}", { title: about.title }) : undefined}
      >
        {!about && <Icon name="mail" size={18} />}
        {label ?? t("Enquire")}
      </Button>
      {opened > 0 && <EnquiryDialog key={opened} page={page} about={about ?? null} onClose={() => setOpened(0)} />}
    </>
  );
}

type Session = "checking" | "guest" | "unverified" | "ready";

function EnquiryDialog({ page, about, onClose }: { page: PageRef; about: About | null; onClose: () => void }) {
  const t = useT();
  const id = useId();
  const pathname = usePathname();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [session, setSession] = useState<Session>("checking");
  const [message, setMessage] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  // Know up front whether the visitor is signed in and verified, so they aren't asked to write first.
  useEffect(() => {
    let live = true;
    api<SessionUser>("/me").then(
      (me) => live && setSession(me.emailVerified ? "ready" : "unverified"),
      (e: unknown) => live && setSession(isApiError(e, "UNAUTHENTICATED") || (isApiError(e) && e.status === 401) ? "guest" : "ready"),
    );
    return () => {
      live = false;
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const body = { about: about ? { type: about.type, id: about.id } : null, message };
    const parsed = EnquiryInput.safeParse(body);
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? t("Write at least {min} characters", { min: ENQUIRY_MIN }));
      textarea.current?.focus();
      return;
    }
    setBusy(true);
    try {
      await api<EnquiryView>(`/pages/${page.slug}/enquiries`, { method: "POST", body: parsed.data });
      setSent(true);
    } catch (e) {
      setBusy(false);
      if (isApiError(e, "UNAUTHENTICATED")) setSession("guest");
      else if (isApiError(e, "VALIDATION_FAILED") && e.fields?.message) {
        setFieldError(e.fields.message);
        textarea.current?.focus();
      } else setError(e);
    }
  }

  const title = sent ? t("Enquiry sent") : about ? t("Enquire about {title}", { title: about.title }) : t("Contact {name}", { name: page.name });
  const signIn = `/signin?next=${encodeURIComponent(pathname)}`;

  if (sent) {
    return (
      <Dialog title={title} onClose={onClose} width={480} footer={<DoneButton />}>
        <p role="status" className="flex items-start gap-3 rounded-[10px] bg-success-light p-4 text-sm text-ink">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-success text-inverse">
            <Icon name="check" size={14} />
          </span>
          Sent. The page’s team will reply in Messages.
        </p>
      </Dialog>
    );
  }

  if (session === "guest") {
    return (
      <Dialog
        title={title}
        onClose={onClose}
        width={480}
        footer={
          <>
            <CancelButton />
            <Link href={signIn} className={buttonClasses()}>
              Sign in
            </Link>
          </>
        }
      >
        <p className="text-sm text-body">Sign in to send an enquiry. Replies from the page’s team arrive in your Messages.</p>
      </Dialog>
    );
  }

  return (
    <Dialog
      title={title}
      description="Your message goes to the people who run this page. They reply in Messages."
      onClose={onClose}
      width={540}
      initialFocus="textarea"
      footer={
        <>
          <CancelButton />
          <Button type="submit" form={`${id}-form`} variant="accent" disabled={busy || session === "unverified"}>
            {busy ? "Sending…" : "Send enquiry"}
          </Button>
        </>
      }
    >
      <form id={`${id}-form`} noValidate onSubmit={submit} className="flex flex-col gap-4">
        {about && (
          <div className="flex items-center gap-2.5 rounded-[10px] border border-line bg-surface px-3.5 py-2.5 text-sm">
            <Icon name={about.type === "product" ? "briefcase" : "lightbulb"} size={18} className="shrink-0 text-secondary" />
            <span className="min-w-0">
              <span className="text-secondary">{about.type === "product" ? t("Product:") : t("Service:")} </span>
              <span className="font-medium text-ink">
                <NoTranslate>{about.title}</NoTranslate>
              </span>
            </span>
          </div>
        )}
        {session === "unverified" && (
          <div className="rounded-lg border border-warning/40 bg-warning-light px-3 py-2.5">
            <VerifyEmailPrompt message="Verify your email address to send enquiries. Check your inbox for the link." />
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-message`} className="text-sm font-medium text-ink">
            Your message
          </label>
          <textarea
            ref={textarea}
            id={`${id}-message`}
            value={message}
            onChange={(event) => {
              setMessage(event.target.value);
              if (fieldError && event.target.value.trim().length >= ENQUIRY_MIN) setFieldError(null);
            }}
            rows={6}
            maxLength={ENQUIRY_MAX}
            required
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? `${id}-message-error` : `${id}-message-hint`}
            placeholder={about ? "What would you like to know? Quantities, timing and where you are help them reply." : "What would you like to ask? Say who you are and what you need."}
            className={inputClasses(!!fieldError, "h-auto resize-y py-2.5")}
          />
          <div className="flex items-start justify-between gap-3 text-xs">
            {fieldError ? (
              <FieldError id={`${id}-message-error`} message={fieldError} />
            ) : (
              <p id={`${id}-message-hint`} className="text-secondary">
                <T vars={{ min: ENQUIRY_MIN }}>{"At least {min} characters."}</T>
              </p>
            )}
            <span aria-hidden="true" className={cn("shrink-0", message.length > ENQUIRY_MAX - 100 ? "text-warning" : "text-secondary")}>
              {message.length} / {ENQUIRY_MAX}
            </span>
          </div>
        </div>
        <div aria-live="polite" className="empty:hidden">
          {error ? <ErrorNotice error={error} /> : null}
        </div>
      </form>
    </Dialog>
  );
}

function CancelButton() {
  return (
    <button type="button" className={buttonClasses({ variant: "secondary" })} onClick={(event) => closeDialog(event.currentTarget)}>
      Cancel
    </button>
  );
}

function DoneButton() {
  return (
    <button type="button" className={buttonClasses()} onClick={(event) => closeDialog(event.currentTarget)}>
      Done
    </button>
  );
}
