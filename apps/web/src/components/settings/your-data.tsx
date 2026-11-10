"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import type { AccountStatus, ConsentRecordView } from "@chartermission/contracts";
import { Button, Panel } from "@chartermission/ui";
import { api } from "@/lib/api/client";
import { formatDateTime } from "@/components/account/format";
import { PasswordConfirmDialog } from "@/components/account/password-confirm-dialog";
import { POLICY_DOCS } from "@/components/account/policy-links";
import { describedBy } from "@/components/auth/fields";
import { SettingsCard } from "./settings-card";
import { T } from "@/i18n/client";

/** Consent history (GET /me/consents, append-only, CM-AUTH-06). */
export function ConsentHistory({ consents }: { consents: ConsentRecordView[] }) {
  return (
    <SettingsCard
      id="consents"
      title="Policies you accepted"
      description="Each time you accept a policy we record its version and the time."
      list={false}
    >
      {consents.length === 0 ? (
        <p className="text-sm text-secondary">No consent records yet.</p>
      ) : (
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[420px] text-start text-sm">
            <caption className="sr-only">Consent history, newest first</caption>
            <thead>
              <tr className="text-label text-secondary">
                <th scope="col" className="px-1 pb-2 font-medium">
                  Policy
                </th>
                <th scope="col" className="px-1 pb-2 font-medium">
                  Version
                </th>
                <th scope="col" className="px-1 pb-2 font-medium">
                  Accepted
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {consents.map((consent, index) => (
                <tr key={`${consent.policyType}-${consent.acceptedAt}-${index}`}>
                  <td className="px-1 py-2.5">
                    <Link href={POLICY_DOCS[consent.policyType].href} className="text-primary-light hover:underline">
                      {POLICY_DOCS[consent.policyType].label}
                    </Link>
                  </td>
                  <td className="px-1 py-2.5 font-mono text-xs text-body">{consent.policyVersion}</td>
                  <td className="px-1 py-2.5 text-body">{formatDateTime(consent.acceptedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SettingsCard>
  );
}

/** Download my data, deactivate (reversible) and request deletion (CM-AUTH-08, spec 8.3). */
export function DataActions({ status }: { status: AccountStatus }) {
  const id = useId();
  const router = useRouter();
  const [dialog, setDialog] = useState<"deactivate" | "delete" | null>(null);
  const [reason, setReason] = useState("");
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const deactivated = status === "deactivated";

  async function download() {
    setExporting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/v1/me/export", { credentials: "same-origin", headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `charter-mission-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage({ tone: "success", text: "Your data was downloaded as a JSON file." });
    } catch {
      setMessage({ tone: "error", text: "The download didn’t start. Please try again." });
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <Panel aria-labelledby={`${id}-export`} className="flex flex-col gap-3 p-5">
        <div className="flex flex-col gap-0.5">
          <h2 id={`${id}-export`} className="text-h3 text-ink">
            Download your data
          </h2>
          <p className="text-sm text-secondary">
            A JSON file with your account, profile, posts, comments, connections, follows and consent history.
          </p>
        </div>
        <Button
          variant="secondary"
          className="self-start"
          onClick={() => void download()}
          disabled={exporting}
          aria-busy={exporting || undefined}
        >
          {exporting ? "Preparing…" : "Download my data"}
        </Button>
        <p role="status" aria-live="polite" className={message?.tone === "error" ? "text-sm text-error" : "text-sm text-success"}>
          {message?.text ?? ""}
        </p>
      </Panel>

      <Panel aria-labelledby={`${id}-close`} className="flex flex-col gap-4 p-5">
        <h2 id={`${id}-close`} className="text-h3 text-ink">
          Deactivate or delete your account
        </h2>
        <div className="flex flex-wrap items-start justify-between gap-3 border-t border-line pt-4">
          <div className="flex max-w-[480px] flex-col gap-0.5">
            <span className="text-sm font-medium text-ink">Deactivate</span>
            <span className="text-sm text-secondary">
              Hides your profile, posts and connections until you reactivate. Sign in any time to come back.
            </span>
          </div>
          <Button variant="secondary" onClick={() => setDialog("deactivate")} disabled={deactivated}>
            {deactivated ? "Deactivated" : "Deactivate account"}
          </Button>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3 border-t border-line pt-4">
          <div className="flex max-w-[480px] flex-col gap-0.5">
            <span className="text-sm font-medium text-ink">Request deletion</span>
            <span className="text-sm text-secondary">
              We review the request and erase your personal data within 30 days. You’ll be signed out everywhere straight away.
            </span>
          </div>
          <Button variant="secondary" className="text-error!" onClick={() => setDialog("delete")}>
            Request deletion
          </Button>
        </div>
      </Panel>

      <PasswordConfirmDialog
        open={dialog === "deactivate"}
        onClose={() => setDialog(null)}
        title="Deactivate your account?"
        description="Your profile, posts and connections will be hidden from other members until you reactivate. You can reactivate any time from this account."
        confirmLabel="Deactivate"
        danger
        onConfirm={async (password) => {
          await api("/me/deactivate", { method: "POST", body: { password } });
          setDialog(null);
          // The account banner (member layout) confirms it and offers reactivation.
          router.refresh();
        }}
      />

      <PasswordConfirmDialog
        open={dialog === "delete"}
        onClose={() => setDialog(null)}
        title="Request account deletion?"
        description={
          <>
            <p>
              Your request goes to our team. Within 30 days we erase your personal data; moderation records keep only a
              pseudonymous ID.
            </p>
            <p className="mt-2">You’ll be signed out on every device. Download your data first if you want a copy.</p>
          </>
        }
        confirmLabel="Request deletion"
        danger
        onConfirm={async (password) => {
          await api("/me/deletion-request", { method: "POST", body: { password, reason: reason.trim() || undefined } });
          setDialog(null);
          router.replace("/signin?notice=deleted");
          router.refresh();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-reason`} className="flex justify-between text-sm font-medium text-ink">
            Why are you leaving? <span className="text-xs font-normal text-secondary"><T vars={{ count: reason.length }}>{"Optional · {count}/500"}</T></span>
          </label>
          <textarea
            id={`${id}-reason`}
            value={reason}
            maxLength={500}
            rows={3}
            onChange={(e) => setReason(e.target.value)}
            aria-describedby={describedBy(`${id}-reason-hint`)}
            className="w-full rounded-lg border border-line bg-card px-3.5 py-2.5 text-sm text-ink hover:border-line-strong focus:border-primary focus:ring-[0.5px] focus:ring-primary focus:outline-none"
          />
          <span id={`${id}-reason-hint`} className="text-xs text-secondary">
            Helps us improve. Only the team handling your request sees it.
          </span>
        </div>
      </PasswordConfirmDialog>
    </>
  );
}
