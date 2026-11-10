"use client";

import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import {
  VERIFICATION_CATEGORY_LABELS,
  VERIFICATION_REAPPLY_DAYS,
  VerificationApplyInput,
  VerificationCategory,
  type VerificationStatus,
} from "@chartermission/contracts";
import { Button, Icon, cn } from "@chartermission/ui";
import { Field, FormAlert, inputClasses } from "@/components/auth/fields";
import { ConfirmDialog } from "@/components/social/confirm-dialog";
import { ErrorNotice } from "@/components/social/errors";
import { absoluteDate } from "@/components/social/format";
import { toast } from "@/components/social/toast";
import { api, isApiError } from "@/lib/api/client";

const STATEMENT_MAX = 1000;

/**
 * Apply for the verified tick: for the member themselves (endpoint /me/verification) or for a page
 * (/pages/{slug}/verification). Shows the checklist, the form, and then the state of the request.
 */
export function VerificationPanel({
  endpoint,
  initial,
  subject,
  defaultName = "",
}: {
  endpoint: string;
  initial: VerificationStatus;
  /** "member" or "page": changes the wording and the categories offered. */
  subject: "member" | "page";
  defaultName?: string;
}) {
  const id = useId();
  const [status, setStatus] = useState(initial);
  const [category, setCategory] = useState<VerificationCategory>(subject === "page" ? "organisation" : "individual");
  const [legalName, setLegalName] = useState(defaultName);
  const [statement, setStatement] = useState("");
  const [links, setLinks] = useState<string[]>([""]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const request = status.request;
  const who = subject === "page" ? "This page" : "You";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setServerError(null);
    const cleaned = links.map((link) => link.trim()).filter(Boolean).map((link) => (/^https?:\/\//i.test(link) ? link : `https://${link}`));
    const parsed = VerificationApplyInput.safeParse({ category, legalName, statement, links: cleaned });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "");
        if (key && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      document.getElementById(`${id}-${Object.keys(next)[0] === "links" ? "link-0" : Object.keys(next)[0]}`)?.focus();
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      setStatus(await api<VerificationStatus>(endpoint, { method: "POST", body: parsed.data }));
      toast.success("Request sent. We’ll let you know the outcome.");
    } catch (error) {
      if (isApiError(error) && error.fields) setErrors(error.fields);
      else setServerError(error);
    } finally {
      setBusy(false);
    }
  }

  if (status.verified) {
    return (
      <div className="flex items-start gap-3 rounded-lg bg-success-light px-4 py-3.5">
        <Icon name="verified" size={22} className="mt-0.5 shrink-0 text-success" />
        <div className="flex flex-col gap-0.5">
          <p className="text-md font-medium text-ink">{subject === "page" ? "This page is verified" : "You’re verified"}</p>
          <p className="text-sm text-body">The tick shows beside the name everywhere on Charter Mission.</p>
        </div>
      </div>
    );
  }

  if (request?.status === "pending") {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3 rounded-lg bg-info-light px-4 py-3.5">
          <Icon name="clock" size={22} className="mt-0.5 shrink-0 text-info" />
          <div className="flex flex-col gap-0.5">
            <p className="text-md font-medium text-ink">Your request is being reviewed</p>
            <p className="text-sm text-body">
              Sent on {absoluteDate(request.createdAt)}. Reviews usually take a few working days; you’ll get a notification and an email with the outcome.
            </p>
          </div>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-secondary">Applying as</dt>
          <dd className="text-ink">{VERIFICATION_CATEGORY_LABELS[request.category]}</dd>
          <dt className="text-secondary">Name</dt>
          <dd className="text-ink">{request.legalName}</dd>
          <dt className="text-secondary">Links</dt>
          <dd className="flex flex-col text-ink">
            {request.links.map((link) => (
              <span key={link} className="break-all">
                {link}
              </span>
            ))}
          </dd>
        </dl>
        <Button variant="secondary" size="small" className="self-start" onClick={() => setWithdrawing(true)}>
          Withdraw request
        </Button>
        {withdrawing && (
          <ConfirmDialog
            title="Withdraw your verification request?"
            confirmLabel="Withdraw"
            onClose={() => setWithdrawing(false)}
            onConfirm={async () => {
              await api(endpoint, { method: "DELETE" });
              setStatus((current) => ({ ...current, request: null }));
              toast.success("Request withdrawn. You can apply again any time.");
            }}
          >
            It leaves the review queue. You can send a new request whenever you like.
          </ConfirmDialog>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {request?.status === "declined" && (
        <FormAlert tone="warning">
          Your last request wasn’t approved{request.decisionNote ? `: “${request.decisionNote}”` : "."}{" "}
          {status.canApplyAt ? `You can apply again from ${absoluteDate(status.canApplyAt)} (${VERIFICATION_REAPPLY_DAYS} days after a decision).` : "You can apply again now."}
        </FormAlert>
      )}

      <div className="flex flex-col gap-2.5">
        <h3 className="text-sm font-medium text-ink">Before you apply</h3>
        <ul className="flex flex-col gap-2">
          {status.requirements.map((item) => (
            <li key={item.key} className="flex items-center gap-2.5 text-sm">
              <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full", item.met ? "bg-success text-inverse" : "border border-line-strong text-transparent")}>
                <Icon name="check" size={12} />
              </span>
              <span className={item.met ? "text-body" : "text-ink"}>
                {item.label}
                <span className="sr-only">{item.met ? " (done)" : " (still to do)"}</span>
              </span>
              {!item.met && item.href && (
                <Link href={item.href} className="text-sm font-medium text-primary-light hover:underline">
                  Do this
                </Link>
              )}
            </li>
          ))}
        </ul>
      </div>

      {status.eligible && !status.canApplyAt ? (
        <form onSubmit={submit} noValidate className="flex flex-col gap-4 border-t border-line pt-5">
          {serverError !== null && <ErrorNotice error={serverError} />}
          <Field id={`${id}-category`} label="Applying as" error={errors.category}>
            <select id={`${id}-category`} value={category} onChange={(event) => setCategory(event.target.value as VerificationCategory)} className={inputClasses(false, "cursor-pointer")}>
              {VerificationCategory.options
                .filter((value) => (subject === "page" ? value === "organisation" || value === "official" : value !== "organisation"))
                .map((value) => (
                  <option key={value} value={value}>
                    {VERIFICATION_CATEGORY_LABELS[value]}
                  </option>
                ))}
            </select>
          </Field>
          <Field
            id={`${id}-legalName`}
            label={subject === "page" ? "Registered name of the organisation" : "Your full legal name"}
            hint={<span className="text-xs text-secondary">Only our reviewers see this</span>}
            error={errors.legalName}
          >
            <input
              id={`${id}-legalName`}
              value={legalName}
              onChange={(event) => setLegalName(event.target.value)}
              maxLength={120}
              aria-invalid={errors.legalName ? true : undefined}
              className={inputClasses(!!errors.legalName)}
            />
          </Field>
          <Field
            id={`${id}-statement`}
            label={subject === "page" ? "Why should this page be verified?" : "Why should your profile be verified?"}
            hint={<span className="text-xs text-secondary">{statement.length} / {STATEMENT_MAX}</span>}
            error={errors.statement}
          >
            <textarea
              id={`${id}-statement`}
              value={statement}
              onChange={(event) => setStatement(event.target.value)}
              maxLength={STATEMENT_MAX}
              rows={4}
              placeholder={
                subject === "page"
                  ? "What the organisation does, and that this is its official page"
                  : "What you do, where people know you from, and why it helps members to know this account is really you"
              }
              aria-invalid={errors.statement ? true : undefined}
              className={inputClasses(!!errors.statement, "h-auto resize-y py-2.5")}
            />
          </Field>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-sm font-medium text-ink">Links that show who {subject === "page" ? "the organisation is" : "you are"}</legend>
            {links.map((link, index) => (
              <div key={index} className="flex gap-2">
                <input
                  id={`${id}-link-${index}`}
                  value={link}
                  onChange={(event) => setLinks((current) => current.map((value, i) => (i === index ? event.target.value : value)))}
                  inputMode="url"
                  placeholder={index === 0 ? "Official website, LinkedIn, a press article or a registry entry" : "Another link (optional)"}
                  aria-label={`Link ${index + 1}`}
                  aria-invalid={errors.links ? true : undefined}
                  className={inputClasses(!!errors.links && index === 0, "flex-1")}
                />
                {links.length > 1 && (
                  <Button variant="ghost" size="small" onClick={() => setLinks((current) => current.filter((_, i) => i !== index))} aria-label={`Remove link ${index + 1}`}>
                    <Icon name="x" size={16} />
                  </Button>
                )}
              </div>
            ))}
            {errors.links && <p className="text-xs text-error">{errors.links}</p>}
            {links.length < 5 && (
              <Button variant="ghost" size="small" className="self-start" onClick={() => setLinks((current) => [...current, ""])}>
                <Icon name="plus" size={16} />
                Add another link
              </Button>
            )}
          </fieldset>
          <p className="text-xs text-secondary">
            {who === "You" ? "Your" : "The"} request is reviewed by the Charter Mission team. Verification confirms identity; it isn’t an endorsement, and it can be removed if the
            account breaks the community guidelines.
          </p>
          <Button type="submit" disabled={busy} className="self-start">
            {busy ? "Sending…" : "Apply for verification"}
          </Button>
        </form>
      ) : (
        !status.canApplyAt && <p className="border-t border-line pt-4 text-sm text-secondary">Finish the checklist and the application form appears here.</p>
      )}
    </div>
  );
}
