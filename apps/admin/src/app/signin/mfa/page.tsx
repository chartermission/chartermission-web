import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MfaVerify } from "@/components/auth/mfa-verify";
import { SignInFormSkeleton } from "@/components/auth/sign-in-form";
import { getViewer } from "@/lib/api/server";
import { HOME_PATH, safeNext, signInUrl } from "@/lib/navigation";

export const metadata: Metadata = { title: "Two-step verification" };

async function VerifyGate({ searchParams }: Pick<PageProps<"/signin/mfa">, "searchParams">) {
  const [viewer, params] = await Promise.all([getViewer(), searchParams]);
  const next = safeNext(params.next);
  if (!viewer) redirect(signInUrl({ next }));
  if (!viewer.mfa.enabled) redirect(`/signin/mfa-setup${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  if (viewer.mfa.verifiedThisSession) redirect(next ?? HOME_PATH);
  return <MfaVerify email={viewer.email} next={next ?? HOME_PATH} />;
}

export default function MfaPage(props: PageProps<"/signin/mfa">) {
  return (
    <Suspense fallback={<SignInFormSkeleton />}>
      <VerifyGate searchParams={props.searchParams} />
    </Suspense>
  );
}
