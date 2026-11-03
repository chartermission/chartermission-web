"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { buttonClasses } from "@chartermission/ui";
import { AuthStatus } from "./auth-shell";
import { DevMailbox } from "./dev-mailbox";
import { ResendVerification } from "./resend-verification";
import { textLinkClasses } from "./fields";

const isDev = process.env.NODE_ENV === "development";

/** After sign-up: explains the next step, offers a resend, and (in development) shows the link. */
export function CheckEmail({ email }: { email: string | null }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [mailboxKey, setMailboxKey] = useState(0);

  useEffect(() => heading.current?.focus(), []);

  return (
    <div className="flex w-full flex-col gap-[18px]">
      <AuthStatus icon="mail" title="Check your email" headingRef={heading}>
        <p className="text-md text-secondary">
          {email ? (
            <>
              We’ve sent an email to <strong className="font-medium break-all text-ink">{email}</strong>.
            </>
          ) : (
            "We’ve sent you an email."
          )}{" "}
          Open the link inside to verify your address — it works for 24 hours.
        </p>
      </AuthStatus>

      <ol className="flex flex-col gap-2 rounded-lg bg-muted p-4 text-sm text-body">
        <li>
          <strong className="font-medium text-ink">1.</strong> Open the email from Charter Mission and select{" "}
          <em className="not-italic font-medium text-ink">Confirm email</em>.
        </li>
        <li>
          <strong className="font-medium text-ink">2.</strong> Sign in and finish setting up your profile — it takes a few
          minutes.
        </li>
        <li>
          <strong className="font-medium text-ink">3.</strong> Once verified you can post, comment and connect.
        </li>
      </ol>

      <div className="flex flex-col gap-2">
        <p className="text-sm text-secondary">Nothing yet? Check your spam folder, then send it again.</p>
        <ResendVerification email={email ?? undefined} askEmail={!email} onSent={() => setMailboxKey((key) => key + 1)} />
      </div>

      {isDev && email && <DevMailbox key={mailboxKey} email={email} kind="verify" />}

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-[18px]">
        <Link href="/signin" className={buttonClasses({ variant: "primary" })}>
          Go to sign in
        </Link>
        <Link href="/signup" className={`px-1 py-2.5 text-sm ${textLinkClasses}`}>
          Use a different email
        </Link>
      </div>
    </div>
  );
}
