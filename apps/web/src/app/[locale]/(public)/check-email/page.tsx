import type { Metadata } from "next";
import { Suspense } from "react";
import { DevMailboxQuery } from "@chartermission/contracts";
import { AuthFormSkeleton, AuthShell } from "@/components/auth/auth-shell";
import { CheckEmail } from "@/components/auth/check-email";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Check your email"), robots: { index: false } };
}

async function CheckEmailWithParams({ searchParams }: Pick<PageProps<"/[locale]/check-email">, "searchParams">) {
  const raw = (await searchParams).email;
  const parsed = DevMailboxQuery.shape.to.safeParse(Array.isArray(raw) ? raw[0] : raw);
  return <CheckEmail email={parsed.success ? parsed.data : null} />;
}

/** After sign-up: what happens next, resend, and the dev mailbox in development. */
export default function CheckEmailPage({ searchParams }: PageProps<"/[locale]/check-email">) {
  return (
    <AuthShell>
      <Suspense fallback={<AuthFormSkeleton rows={2} />}>
        <CheckEmailWithParams searchParams={searchParams} />
      </Suspense>
    </AuthShell>
  );
}
