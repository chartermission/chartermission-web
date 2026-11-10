import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthFormSkeleton, AuthShell } from "@/components/auth/auth-shell";
import { safeNext } from "@/components/auth/destinations";
import { RedirectIfSignedIn } from "@/components/auth/redirect-if-signed-in";
import { SignInForm, type SignInNotice } from "@/components/auth/signin-form";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to Charter Mission to see your feed, network and opportunities.",
};

const notices: SignInNotice[] = ["reset", "deleted", "signedout", "verified", "expired"];

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

async function SignInWithParams({ searchParams }: Pick<PageProps<"/[locale]/signin">, "searchParams">) {
  const params = await searchParams;
  const next = safeNext(first(params.next));
  const noticeParam = first(params.notice);
  const notice = notices.find((n) => n === noticeParam) ?? null;
  return (
    <>
      <Suspense fallback={null}>
        <RedirectIfSignedIn to={next ?? "/feed"} />
      </Suspense>
      <SignInForm next={next} notice={notice} />
    </>
  );
}

/** Sign in — same split layout as sign up (Figma 17:1511). */
export default function SignInPage({ searchParams }: PageProps<"/[locale]/signin">) {
  return (
    <AuthShell heading="Welcome back to the community building Africa’s next chapter">
      <Suspense fallback={<AuthFormSkeleton rows={2} />}>
        <SignInWithParams searchParams={searchParams} />
      </Suspense>
    </AuthShell>
  );
}
