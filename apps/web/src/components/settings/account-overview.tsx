import Link from "next/link";
import type { AccountStatus } from "@chartermission/contracts";
import { Chip } from "@chartermission/ui";
import { ResendVerification } from "@/components/auth/resend-verification";
import { SettingsCard } from "./settings-card";
import { UsernameEditor } from "./username-editor";

const statusCopy: Record<AccountStatus, { label: string; tone: "success" | "warning" | "error" | "neutral"; text: string }> = {
  unverified: { label: "Unverified", tone: "warning", text: "Verify your email to post, comment and connect." },
  active: { label: "Active", tone: "success", text: "Your account is in good standing." },
  deactivated: { label: "Deactivated", tone: "neutral", text: "Your profile is hidden until you reactivate." },
  suspended: { label: "Suspended", tone: "error", text: "See Moderation & reports for details and to appeal." },
  deletion_pending: { label: "Deletion pending", tone: "warning", text: "Your deletion request is being processed." },
  deleted: { label: "Deleted", tone: "neutral", text: "" },
};

const rowLabel = "text-sm font-medium text-ink";
const rowValue = "text-sm text-body";

/** Read-only account summary at the top of /settings. */
export function AccountOverview({
  email,
  emailVerified,
  status,
  handle,
  handleChangeAvailableAt,
  mfaEnabled,
}: {
  email: string;
  emailVerified: boolean;
  status: AccountStatus;
  handle: string;
  /** When the username can next be changed; null when it can be changed now. */
  handleChangeAvailableAt: string | null;
  mfaEnabled: boolean;
}) {
  const state = statusCopy[status];
  return (
    <SettingsCard id="account" title="Your account">
      <li className="flex flex-wrap items-start justify-between gap-3 py-3.5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className={rowLabel}>Email</span>
          <span className={`${rowValue} break-all`}>{email}</span>
          {!emailVerified && <span className="text-xs text-secondary">We sent a verification link to this address.</span>}
        </div>
        {emailVerified ? (
          <Chip tone="success">Verified</Chip>
        ) : (
          <div className="flex flex-col items-end gap-2 max-sm:items-start">
            <Chip tone="warning">Not verified</Chip>
            <ResendVerification size="small" label="Resend email" className="items-end max-sm:items-start" />
          </div>
        )}
      </li>
      <li className="flex flex-wrap items-center justify-between gap-3 py-3.5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className={rowLabel}>Account status</span>
          <span className="text-xs text-secondary">{state.text}</span>
        </div>
        <Chip tone={state.tone}>{state.label}</Chip>
      </li>
      <UsernameEditor handle={handle} availableAt={handleChangeAvailableAt} />
      <li className="flex flex-wrap items-center justify-between gap-3 py-3.5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className={rowLabel}>Two-step verification</span>
          <span className="text-xs text-secondary">
            {mfaEnabled ? "On — an authenticator code is needed to sign in to the console." : "Off"}
          </span>
        </div>
        <Link href="/settings/security" className="text-sm font-medium text-primary-light hover:underline">
          Manage
        </Link>
      </li>
    </SettingsCard>
  );
}
