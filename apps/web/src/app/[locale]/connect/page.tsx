import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { OAuthAuthorizeQuery, type OAuthAuthorizeCheck } from "@chartermission/contracts";
import { settle } from "@/components/account/settle";
import { AuthFormSkeleton, AuthShell } from "@/components/auth/auth-shell";
import { destinationFor, safeNext } from "@/components/auth/destinations";
import { ConnectConsent, ConnectProblem } from "@/components/connect/connect-consent";
import { apiGet, getViewer } from "@/lib/api/server";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Connect Claude"), robots: { index: false } };
}

const highlights = [
  "Claude acts only as you, within the same rules as the app",
  "Hourly limits on posts, comments and connection requests",
  "Everything Claude does is listed in your settings",
  "Disconnect anytime in Settings → Connected apps",
];

/** The OAuth request exactly as it arrived: first value of each field, in the order given. */
function oauthParams(raw: Record<string, string | string[] | undefined>): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === "string") params[key] = first;
  }
  return params;
}

async function Consent({ searchParams }: Pick<PageProps<"/[locale]/connect">, "searchParams">) {
  const params = oauthParams(await searchParams);
  const query = new URLSearchParams(params).toString();
  const here = `/connect${query ? `?${query}` : ""}`;
  const back = encodeURIComponent(here);

  // Sign-in, two-step verification and changed policies all bring the member back to this exact request.
  const viewer = await getViewer().catch(() => null);
  if (!viewer) redirect(`/signin?next=${back}`);
  if (viewer.mfa.enabled && !viewer.mfa.verifiedThisSession) redirect(`/signin/mfa?next=${back}`);
  const next = destinationFor(viewer, here);
  if (next !== safeNext(here)) redirect(next);

  const t = await getT();
  const invalid = () => (
    <ConnectProblem
      title={t("This connection request isn’t valid")}
      message={t("The link that opened this page is incomplete or has expired. Go back to Claude and start connecting Charter Mission again.")}
    />
  );
  if (!OAuthAuthorizeQuery.safeParse(params).success) return invalid();

  const result = await settle(apiGet<OAuthAuthorizeCheck>("/oauth/authorize/check", params));
  if (!result.ok) {
    const { status, code } = result.error;
    if (status === 401) redirect(`/signin?notice=expired&next=${back}`);
    if (code === "MFA_REQUIRED") redirect(`/signin/mfa?next=${back}`);
    if (code === "MFA_SETUP_REQUIRED") redirect(`/signin/mfa-setup?next=${back}`);
    if (code === "POLICY_REACCEPT_REQUIRED") redirect(`/policies/accept?next=${back}`);
    if (status === 400 || status === 404 || code === "VALIDATION_FAILED") return invalid();
    return (
      <ConnectProblem
        title={t("We couldn’t check this connection request")}
        message={result.error.message || t("Check your connection and try again.")}
        retry
      />
    );
  }
  return <ConnectConsent check={result.data} params={params} here={here} emailVerified={viewer.emailVerified} />;
}

/**
 * Claude's consent screen, reached from the MCP server's /authorize with the OAuth request in the
 * query. It sits outside the member layout so the decision is the only thing on screen; the proxy
 * still sends signed-out visitors to sign in first (MEMBER_AREAS).
 */
export default function ConnectPage({ searchParams }: PageProps<"/[locale]/connect">) {
  return (
    <AuthShell heading="Let Claude help you share your work with the community" highlights={highlights}>
      <Suspense fallback={<AuthFormSkeleton rows={3} />}>
        <Consent searchParams={searchParams} />
      </Suspense>
    </AuthShell>
  );
}
