import type { Metadata } from "next";
import { Suspense } from "react";
import type { SessionView } from "@chartermission/contracts";
import { LoadError } from "@/components/account/load-error";
import { settle } from "@/components/account/settle";
import { ChangePasswordForm } from "@/components/settings/change-password-form";
import { MfaCard } from "@/components/settings/mfa-card";
import { SessionsList } from "@/components/settings/sessions-list";
import { SettingsCardSkeleton, SettingsHeader } from "@/components/settings/settings-card";
import { apiGet, requireViewer } from "@/lib/api/server";

export const metadata: Metadata = { title: "Security & sign-in" };

const PRIVILEGED = ["moderator", "platform_admin", "super_admin"];

async function Sessions() {
  const result = await settle(apiGet<SessionView[]>("/me/sessions"));
  if (!result.ok) return <LoadError title="Your sessions didn’t load" message={result.error.message} />;
  return <SessionsList initial={result.data} />;
}

async function AccountSecurity() {
  const viewer = await requireViewer("/settings/security");
  return (
    <>
      <ChangePasswordForm name={viewer.name} email={viewer.email} />
      <MfaCard enabled={viewer.mfa.enabled} required={viewer.roles.some((role) => PRIVILEGED.includes(role))} />
    </>
  );
}

/** Password, active sessions and optional two-step verification (spec 4.2, CM-AUTH-03/04/09). */
export default function SecuritySettingsPage() {
  return (
    <>
      <SettingsHeader
        title="Security & sign-in"
        description="Keep your account safe: your password, where you’re signed in and two-step verification."
      />
      <Suspense fallback={<SettingsCardSkeleton rows={3} />}>
        <AccountSecurity />
      </Suspense>
      <Suspense fallback={<SettingsCardSkeleton rows={2} />}>
        <Sessions />
      </Suspense>
    </>
  );
}
