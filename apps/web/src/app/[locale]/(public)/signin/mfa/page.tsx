import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthFormSkeleton, AuthShell } from "@/components/auth/auth-shell";
import { destinationFor, safeNext } from "@/components/auth/destinations";
import { MfaVerifyForm } from "@/components/auth/mfa-verify-form";
import { getViewer } from "@/lib/api/server";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Two-step verification") };
}

async function MfaStep({ searchParams }: Pick<PageProps<"/[locale]/signin/mfa">, "searchParams">) {
  const params = await searchParams;
  const next = safeNext(Array.isArray(params.next) ? params.next[0] : params.next);
  const viewer = await getViewer().catch(() => null);
  if (!viewer) redirect(next ? `/signin?next=${encodeURIComponent(next)}` : "/signin");
  if (!viewer.mfa.enabled || viewer.mfa.verifiedThisSession) redirect(destinationFor(viewer, next));
  return <MfaVerifyForm next={next} />;
}

/** Second sign-in step for members with two-step verification on. */
export default function MfaPage({ searchParams }: PageProps<"/[locale]/signin/mfa">) {
  return (
    <AuthShell heading="Keeping your account secure">
      <Suspense fallback={<AuthFormSkeleton rows={1} />}>
        <MfaStep searchParams={searchParams} />
      </Suspense>
    </AuthShell>
  );
}
