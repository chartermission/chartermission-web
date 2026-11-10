"use client";

import Link from "next/link";
import { Icon, cn } from "@chartermission/ui";
import { ResendVerification } from "@/components/auth/resend-verification";
import { T } from "@/i18n/client";

/** Shown instead of a generic error when an action returns 403 EMAIL_NOT_VERIFIED. */
export function VerifyPrompt({ action = "do this", className }: { action?: string; className?: string }) {
  return (
    <div role="status" className={cn("flex items-start gap-2.5 rounded-lg bg-info-light p-3 text-sm text-body", className)}>
      <Icon name="mail" size={16} className="mt-px shrink-0 text-info" />
      <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
        <p>
          <strong className="font-medium text-ink"><T vars={{ action }}>{"Verify your email to {action}."}</T></strong> Open the link we emailed you, or send a
          new one.
        </p>
        <ResendVerification size="small" label="Resend verification email" />
      </div>
    </div>
  );
}

/** Shown when an action returns ACCOUNT_RESTRICTED or ACCOUNT_SUSPENDED. */
export function RestrictedPrompt({ message, className }: { message: string; className?: string }) {
  return (
    <div role="status" className={cn("flex items-start gap-2.5 rounded-lg bg-warning-light p-3 text-sm text-body", className)}>
      <Icon name="shield" size={16} className="mt-px shrink-0 text-warning" />
      <p>
        {message}{" "}
        <Link href="/settings/moderation" className="font-medium text-primary underline underline-offset-2">
          See details and appeal
        </Link>
      </p>
    </div>
  );
}
