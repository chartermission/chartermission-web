import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthFormSkeleton, AuthShell } from "@/components/auth/auth-shell";
import { Unsubscribe } from "@/components/notifications/unsubscribe";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  // The address carries the reader's token: keep it out of search engines and other sites' logs.
  return { title: t("Unsubscribe"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

async function UnsubscribeWithToken({ searchParams }: Pick<PageProps<"/[locale]/unsubscribe">, "searchParams">) {
  const raw = (await searchParams).t;
  const token = (Array.isArray(raw) ? raw[0] : raw)?.trim() || null;
  return <Unsubscribe token={token} />;
}

/** Target of the unsubscribe link in Charter Mission's bulk emails. Works signed in or out. */
export default function UnsubscribePage({ searchParams }: PageProps<"/[locale]/unsubscribe">) {
  return (
    <AuthShell>
      <Suspense fallback={<AuthFormSkeleton rows={0} />}>
        <UnsubscribeWithToken searchParams={searchParams} />
      </Suspense>
    </AuthShell>
  );
}
