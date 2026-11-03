import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata: Metadata = { title: "Reset your password" };

/** Request a password reset link (CM-AUTH-04). */
export default function ForgotPasswordPage() {
  return (
    <AuthShell heading="Get back into your account">
      <ForgotPasswordForm />
    </AuthShell>
  );
}
