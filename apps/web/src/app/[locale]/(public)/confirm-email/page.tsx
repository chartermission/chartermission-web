import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthFormSkeleton, AuthShell } from "@/components/auth/auth-shell";
import { ConfirmEmail } from "@/components/auth/confirm-email";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Confirm your new email"), robots: { index: false } };
}

async function ConfirmWithToken({ searchParams }: Pick<PageProps<"/[locale]/confirm-email">, "searchParams">) {
  const raw = (await searchParams).token;
  const token = (Array.isArray(raw) ? raw[0] : raw)?.trim() || null;
  return <ConfirmEmail token={token} />;
}

/** Target of the link sent to a new email address (Settings → Email → Change). */
export default function ConfirmEmailPage({ searchParams }: PageProps<"/[locale]/confirm-email">) {
  return (
    <AuthShell>
      <Suspense fallback={<AuthFormSkeleton rows={1} />}>
        <ConfirmWithToken searchParams={searchParams} />
      </Suspense>
    </AuthShell>
  );
}
