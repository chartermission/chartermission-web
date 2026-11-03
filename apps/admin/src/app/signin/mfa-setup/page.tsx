import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MfaSetup } from "@/components/auth/mfa-setup";
import { SignInFormSkeleton } from "@/components/auth/sign-in-form";
import { getViewer } from "@/lib/api/server";
import { HOME_PATH, safeNext, signInUrl } from "@/lib/navigation";

export const metadata: Metadata = { title: "Set up two-step verification" };

/** Only a signed-in admin without MFA belongs here; everyone else is sent to their next step. */
async function SetupGate({ searchParams }: Pick<PageProps<"/signin/mfa-setup">, "searchParams">) {
  const [viewer, params] = await Promise.all([getViewer(), searchParams]);
  const next = safeNext(params.next);
  if (!viewer) redirect(signInUrl({ next }));
  const q = next ? `?next=${encodeURIComponent(next)}` : "";
  if (viewer.mfa.enabled) redirect(viewer.mfa.verifiedThisSession ? (next ?? HOME_PATH) : `/signin/mfa${q}`);
  return <MfaSetup email={viewer.email} next={next ?? HOME_PATH} />;
}

export default function MfaSetupPage(props: PageProps<"/signin/mfa-setup">) {
  return (
    <Suspense fallback={<SignInFormSkeleton />}>
      <SetupGate searchParams={props.searchParams} />
    </Suspense>
  );
}
