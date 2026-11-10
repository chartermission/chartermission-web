import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthFormSkeleton, AuthShell } from "@/components/auth/auth-shell";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const metadata: Metadata = { title: "Choose a new password", robots: { index: false } };

async function ResetWithToken({ searchParams }: Pick<PageProps<"/[locale]/reset-password">, "searchParams">) {
  const raw = (await searchParams).token;
  const token = (Array.isArray(raw) ? raw[0] : raw)?.trim() || null;
  return <ResetPasswordForm token={token} />;
}

/** Target of the password reset email link (CM-AUTH-04). */
export default function ResetPasswordPage({ searchParams }: PageProps<"/[locale]/reset-password">) {
  return (
    <AuthShell heading="Get back into your account">
      <Suspense fallback={<AuthFormSkeleton rows={2} />}>
        <ResetWithToken searchParams={searchParams} />
      </Suspense>
    </AuthShell>
  );
}
