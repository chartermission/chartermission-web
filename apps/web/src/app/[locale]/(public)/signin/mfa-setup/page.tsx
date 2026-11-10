import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthFormSkeleton, AuthShell } from "@/components/auth/auth-shell";
import { destinationFor, safeNext } from "@/components/auth/destinations";
import { MfaSetupForm } from "@/components/auth/mfa-setup-form";
import { getViewer } from "@/lib/api/server";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Set up two-step verification") };
}

async function SetupStep({ searchParams }: Pick<PageProps<"/[locale]/signin/mfa-setup">, "searchParams">) {
  const params = await searchParams;
  const next = safeNext(Array.isArray(params.next) ? params.next[0] : params.next);
  const viewer = await getViewer().catch(() => null);
  if (!viewer) redirect(next ? `/signin?next=${encodeURIComponent(next)}` : "/signin");
  if (viewer.mfa.enabled || !viewer.mfa.required) redirect(destinationFor(viewer, next));
  return <MfaSetupForm email={viewer.email} next={next} />;
}

/** Staff accounts: required two-step verification setup before using the member app. */
export default function MfaSetupPage({ searchParams }: PageProps<"/[locale]/signin/mfa-setup">) {
  return (
    <AuthShell heading="Keeping your account secure">
      <Suspense fallback={<AuthFormSkeleton rows={2} />}>
        <SetupStep searchParams={searchParams} />
      </Suspense>
    </AuthShell>
  );
}
