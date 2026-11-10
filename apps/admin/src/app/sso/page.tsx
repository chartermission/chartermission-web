import { Suspense } from "react";
import type { Metadata } from "next";
import SignInLayout from "../signin/layout";
import { SingleSignOnAuto } from "@/components/auth/sso";

export const metadata: Metadata = { title: "Opening the console" };

/** Arrive here from the member site (account menu → Admin console): single sign-on, then the console. */
export default function SsoPage() {
  return (
    <SignInLayout>
      <Suspense fallback={null}>
        <SingleSignOnAuto />
      </Suspense>
    </SignInLayout>
  );
}
