import Link from "next/link";
import type { AccountStatus } from "@chartermission/contracts";
import { Chip } from "@chartermission/ui";
import { EmailEditor } from "./email-editor";
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

/** Read-only account summary at the top of /settings. */
export function AccountOverview({
  email,
  emailVerified,
  pendingEmail,
  status,
  handle,
  handleChangeAvailableAt,
  mfaEnabled,
}: {
  email: string;
  emailVerified: boolean;
  pendingEmail: string | null;
  status: AccountStatus;
  handle: string;
  /** When the username can next be changed; null when it can be changed now. */
  handleChangeAvailableAt: string | null;
  mfaEnabled: boolean;
}) {
  const state = statusCopy[status];
  return (
    <SettingsCard id="account" title="Your account">
      <EmailEditor email={email} emailVerified={emailVerified} pendingEmail={pendingEmail} />
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
