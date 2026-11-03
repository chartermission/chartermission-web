"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ConsentRecordView, PolicyType, SessionUser } from "@chartermission/contracts";
import { Button, Icon } from "@chartermission/ui";
import { api, isApiError } from "@/lib/api/client";
import { FormAlert, retryMessage } from "@/components/auth/fields";
import { destinationFor } from "@/components/auth/destinations";
import { formatDate } from "./format";
import { POLICY_DOCS } from "./policy-links";

export type AcceptedPolicy = {
  policyType: PolicyType;
  /** The version in force now (GET /policies). */
  current: string;
  accepted: { version: string; acceptedAt: string } | null;
};

/** /policies/accept — review the changed policies and record new consent rows (POST /me/consents). */
export function AcceptPolicies({
  policies,
  next,
  upToDate,
}: {
  policies: AcceptedPolicy[];
  next: string | null;
  upToDate: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<ConsentRecordView[] | null>(null);

  async function continueOn() {
    const me = await api<SessionUser>("/me").catch(() => null);
    router.replace(me ? destinationFor({ ...me, needsPolicyReaccept: false }, next) : "/signin");
    router.refresh();
  }

  async function accept() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const records = await api<ConsentRecordView[]>("/me/consents", { method: "POST", body: { accept: true } });
      setAccepted(records.slice(0, policies.length));
      await continueOn();
    } catch (e) {
      setBusy(false);
      if (isApiError(e, "UNAUTHENTICATED")) router.replace("/signin?next=/policies/accept");
      else if (isApiError(e, "RATE_LIMITED")) setError(retryMessage(e.retryAfter));
      else setError(isApiError(e) ? e.message : "Something went wrong. Please try again.");
    }
  }

  const changed = (policy: AcceptedPolicy) => !policy.accepted || policy.accepted.version !== policy.current;
  const anyKnown = policies.some(changed);

  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex flex-col gap-1.5">
        <span className="mb-3 flex size-12 items-center justify-center rounded-full bg-info-light text-info">
          <Icon name="shield" size={24} />
        </span>
        <h1 className="text-h1 text-ink">{upToDate ? "You’re up to date" : "We’ve updated our policies"}</h1>
        <p className="text-md text-secondary">
          {upToDate
            ? "You’ve accepted the current versions of all our policies."
            : "Please review what changed and accept the new versions to keep using Charter Mission."}
        </p>
      </div>

      <ul className="flex flex-col divide-y divide-line rounded-card border border-line">
        {policies.map((policy) => {
          const doc = POLICY_DOCS[policy.policyType];
          return (
            <li key={policy.policyType} className="flex items-center gap-3 px-4 py-3">
              <Icon name="book" size={18} className="shrink-0 text-secondary" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <Link
                  href={doc.href}
                  target="_blank"
                  className="text-sm font-medium text-primary-light underline-offset-2 hover:underline"
                >
                  {doc.label}
                  <span className="sr-only"> (opens in a new tab)</span>
                </Link>
                <span className="text-xs text-secondary">
                  {policy.accepted
                    ? `You accepted version ${policy.accepted.version} on ${formatDate(policy.accepted.acceptedAt)}`
                    : "Not accepted yet"}
                </span>
              </div>
              {!upToDate &&
                (changed(policy) ? (
                  <span className="rounded-full bg-warning-light px-2 py-0.5 text-xs font-medium text-warning">Updated</span>
                ) : !anyKnown ? (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-body">Review</span>
                ) : null)}
            </li>
          );
        })}
      </ul>

      <div aria-live="polite">
        {error && <FormAlert tone="error">{error}</FormAlert>}
        {accepted && (
          <FormAlert tone="success">
            Accepted {accepted.map((r) => `${POLICY_DOCS[r.policyType].label} ${r.policyVersion}`).join(", ")}. Taking you back…
          </FormAlert>
        )}
      </div>

      {upToDate ? (
        <Button onClick={() => void continueOn()} className="self-start">
          Continue
        </Button>
      ) : (
        <>
          <p className="text-sm text-secondary">
            By selecting “Accept and continue” you agree to the current Terms of Use, Privacy Notice and Community Guidelines. We
            record the versions and the time you accepted them.
          </p>
          <Button onClick={() => void accept()} disabled={busy} aria-busy={busy || undefined} block>
            {busy ? "Saving…" : "Accept and continue"}
          </Button>
          <p className="text-center text-sm text-secondary">
            Don’t agree?{" "}
            <Link href="/settings/data" className="font-medium text-primary-light hover:underline">
              Manage or delete your account
            </Link>
          </p>
        </>
      )}
    </div>
  );
}
