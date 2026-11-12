import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { INVITE_EVENT_COOKIE } from "@/lib/invite";
import { AuthFormSkeleton, AuthShell } from "@/components/auth/auth-shell";
import { safeNext } from "@/components/auth/destinations";
import { RedirectIfSignedIn } from "@/components/auth/redirect-if-signed-in";
import { SignInForm, type SignInNotice } from "@/components/auth/signin-form";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t("Sign in"),
    description: t("Sign in to Charter Mission to see your feed, network and opportunities."),
  };
}

const notices: SignInNotice[] = ["reset", "deleted", "signedout", "verified", "expired"];

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

async function SignInWithParams({ searchParams }: Pick<PageProps<"/[locale]/signin">, "searchParams">) {
  const params = await searchParams;
  // Arrived from an event invitation and already a member: go to the event after signing in.
  const invitedEvent = (await cookies()).get(INVITE_EVENT_COOKIE)?.value;
  const next = safeNext(first(params.next)) ?? (invitedEvent && /^[a-z0-9-]{1,200}$/.test(invitedEvent) ? `/events/${invitedEvent}` : null);
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
