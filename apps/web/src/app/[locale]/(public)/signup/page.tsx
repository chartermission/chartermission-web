import type { Metadata } from "next";
import { Suspense } from "react";
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
  const result = await settle(getTaxonomies());
  if (!result.ok)
    return <LoadError title="We couldn’t load the sign-up form" message={result.error.message} retryHref="/signup" />;
  return <SignUpForm countryGroups={groupCountries(result.data.countries)} />;
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
