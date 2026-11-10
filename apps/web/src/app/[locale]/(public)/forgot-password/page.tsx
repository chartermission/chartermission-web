import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Reset your password") };
}

/** Request a password reset link (CM-AUTH-04). */
export default function ForgotPasswordPage() {
  return (
    <AuthShell heading="Get back into your account">
      <ForgotPasswordForm />
    </AuthShell>
  );
}
