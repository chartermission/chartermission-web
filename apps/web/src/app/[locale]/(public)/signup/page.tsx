import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";
import type { InvitePreview } from "@chartermission/contracts";
import { INVITE_REF_COOKIE, parseInviteRef } from "@/lib/invite";
import { apiGetOrNull } from "@/lib/api/server";
import { AuthFormSkeleton, AuthShell } from "@/components/auth/auth-shell";
import { RedirectIfSignedIn } from "@/components/auth/redirect-if-signed-in";
import { LoadError } from "@/components/account/load-error";
import { settle } from "@/components/account/settle";
import { SignUpForm } from "@/components/public/signup-form";
import { getTaxonomies, groupCountries } from "@/lib/taxonomies";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t("Create your account"),
    description:
      t("Join Charter Mission free: connect with professionals in 54 countries and the diaspora, find reviewed opportunities and start or join initiatives."),
  };
}

async function SignUpFormWithCountries() {
  const invite = parseInviteRef((await cookies()).get(INVITE_REF_COOKIE)?.value);
  const [result, preview] = await Promise.all([
    settle(getTaxonomies()),
    invite ? apiGetOrNull<InvitePreview>("/invites/preview", invite) : Promise.resolve(null),
  ]);
  if (!result.ok)
    return <LoadError title="We couldn’t load the sign-up form" message={result.error.message} retryHref="/signup" />;
  return (
    <SignUpForm
      countryGroups={groupCountries(result.data.countries)}
      invite={invite && preview?.inviter ? { ref: invite, inviterName: preview.inviter.name, targetTitle: preview.target?.title ?? null } : null}
    />
  );
}

/** Sign up — Figma "Web / Sign up" (node 17:1511). */
export default function SignUpPage() {
  return (
    <AuthShell>
      <Suspense fallback={null}>
        <RedirectIfSignedIn />
      </Suspense>
      <Suspense fallback={<AuthFormSkeleton rows={4} />}>
        <SignUpFormWithCountries />
      </Suspense>
    </AuthShell>
  );
}
