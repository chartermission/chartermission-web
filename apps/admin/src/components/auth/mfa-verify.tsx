"use client";

import { useRouter } from "next/navigation";
import { SignOutButton } from "@/components/shell/sign-out-button";
import { api } from "@/lib/api/client";
import { CodeForm } from "./code-form";

/** Second sign-in step: a TOTP code verifies this admin session (POST /auth/mfa/verify). */
export function MfaVerify({ email, next }: { email: string; next: string }) {
  const router = useRouter();

  async function verify(code: string) {
    await api("/auth/mfa/verify", { method: "POST", body: { code }, authFlow: true });
    router.replace(next);
    router.refresh();
  }

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-h2 text-ink">Enter your verification code</h1>
        <p className="text-sm text-secondary">
          Signed in as <span className="font-medium text-ink">{email}</span>. Admin sessions need a code from your
          authenticator app every time you sign in.
        </p>
      </div>
      <CodeForm submitLabel="Verify and continue" busyLabel="Verifying…" onSubmit={verify} />
      <div className="flex items-center justify-between gap-3 border-t border-line pt-4 text-sm text-secondary">
        <span>Not you, or lost your device?</span>
        <SignOutButton tone="light" />
      </div>
    </>
  );
}
