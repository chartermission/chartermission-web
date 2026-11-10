import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthFormSkeleton, AuthShell } from "@/components/auth/auth-shell";
import { VerifyEmail } from "@/components/auth/verify-email";

export const metadata: Metadata = { title: "Verify your email", robots: { index: false } };

async function VerifyWithToken({ searchParams }: Pick<PageProps<"/[locale]/verify-email">, "searchParams">) {
  const raw = (await searchParams).token;
  const token = (Array.isArray(raw) ? raw[0] : raw)?.trim() || null;
  return <VerifyEmail token={token} />;
}

/** Target of the verification email link (CM-AUTH-02). */
export default function VerifyEmailPage({ searchParams }: PageProps<"/[locale]/verify-email">) {
  return (
    <AuthShell>
      <Suspense fallback={<AuthFormSkeleton rows={1} />}>
        <VerifyWithToken searchParams={searchParams} />
      </Suspense>
    </AuthShell>
  );
}
