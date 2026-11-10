import type { Metadata } from "next";
import { Suspense } from "react";
import type { NotificationPreferences } from "@chartermission/contracts";
import { LoadError } from "@/components/account/load-error";
import { settle } from "@/components/account/settle";
import { RestrictedPrompt } from "@/components/account/verify-prompt";
import { NotificationPreferencesForm } from "@/components/settings/notification-preferences-form";
import { SettingsHeader, SettingsPageSkeleton } from "@/components/settings/settings-card";
import { apiGet } from "@/lib/api/server";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Notification settings") };
}

async function Preferences() {
  const t = await getT();
  const result = await settle(apiGet<NotificationPreferences>("/me/notification-preferences"));
  if (result.ok) return <NotificationPreferencesForm initial={result.data} />;
  const { error } = result;
  if (error.code === "ACCOUNT_SUSPENDED" || error.code === "ACCOUNT_DEACTIVATED") {
    return <RestrictedPrompt message={t("{message} Notification settings are available once it’s active again.", { message: error.message })} />;
  }
  return <LoadError title="Your notification settings didn’t load" message={error.message} />;
}

/** Notification preferences (CM-NTF-03); target of the unsubscribe link in emails. */
export default function NotificationSettingsPage() {
  return (
    <>
      <SettingsHeader
        title="Notifications"
        description="Choose what you hear about in the app and by email. Turning off email never stops security messages."
      />
      <Suspense fallback={<SettingsPageSkeleton cards={1} rows={8} />}>
        <Preferences />
      </Suspense>
    </>
  );
}
