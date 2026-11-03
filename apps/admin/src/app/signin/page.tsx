import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignInForm, SignInFormSkeleton } from "@/components/auth/sign-in-form";
import { getViewer } from "@/lib/api/server";
import { HOME_PATH, safeNext } from "@/lib/navigation";

export const metadata: Metadata = { title: "Sign in" };

/** An admin who is already fully signed in goes straight to where they were heading. */
async function RedirectIfSignedIn({ searchParams }: Pick<PageProps<"/signin">, "searchParams">) {
  const [viewer, params] = await Promise.all([getViewer().catch(() => null), searchParams]);
  if (viewer?.sessionAudience === "admin" && viewer.mfa.verifiedThisSession) {
    redirect(safeNext(params.next) ?? HOME_PATH);
  }
  return null;
}

export default function SignInPage(props: PageProps<"/signin">) {
  return (
    <>
      <Suspense fallback={null}>
        <RedirectIfSignedIn searchParams={props.searchParams} />
      </Suspense>
      <Suspense fallback={<SignInFormSkeleton />}>
        <SignInForm />
      </Suspense>
    </>
  );
}
