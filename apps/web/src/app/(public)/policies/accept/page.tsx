import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PolicyType, type ConsentRecordView, type PolicyVersions } from "@chartermission/contracts";
import { AcceptPolicies, type AcceptedPolicy } from "@/components/account/accept-policies";
import { LoadError } from "@/components/account/load-error";
import { AuthFormSkeleton, AuthShell } from "@/components/auth/auth-shell";
import { safeNext } from "@/components/auth/destinations";
import { apiGet, getViewer } from "@/lib/api/server";

export const metadata: Metadata = { title: "Review our updated policies", robots: { index: false } };

async function AcceptWithSession({ searchParams }: Pick<PageProps<"/policies/accept">, "searchParams">) {
  const raw = (await searchParams).next;
  const next = safeNext(Array.isArray(raw) ? raw[0] : raw);
  const viewer = await getViewer().catch(() => null);
  if (!viewer)
    redirect(`/signin?next=${encodeURIComponent(`/policies/accept${next ? `?next=${encodeURIComponent(next)}` : ""}`)}`);
  let consents: ConsentRecordView[];
  let current: PolicyVersions;
  try {
    [consents, current] = await Promise.all([
      apiGet<ConsentRecordView[]>("/me/consents"),
      apiGet<PolicyVersions>("/policies"),
    ]);
  } catch {
    return <LoadError title="We couldn’t load your policy history" bare />;
  }
  // Newest first: the first row per policy is the version last accepted.
  const policies: AcceptedPolicy[] = PolicyType.options.map((policyType) => {
    const latest = consents.find((c) => c.policyType === policyType);
    return { policyType, current: current[policyType], accepted: latest ? { version: latest.policyVersion, acceptedAt: latest.acceptedAt } : null };
  });
  return <AcceptPolicies policies={policies} next={next} upToDate={!viewer.needsPolicyReaccept} />;
}

/** Re-accept changed policies at next sign-in (spec 4.2 rules, CM-AUTH-06). */
export default function AcceptPoliciesPage({ searchParams }: PageProps<"/policies/accept">) {
  return (
    <AuthShell heading="Clear rules, applied the same way to everyone">
      <Suspense fallback={<AuthFormSkeleton rows={2} />}>
        <AcceptWithSession searchParams={searchParams} />
      </Suspense>
    </AuthShell>
  );
}
