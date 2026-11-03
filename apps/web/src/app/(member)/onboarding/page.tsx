import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import type { OnboardingState, OwnProfile } from "@chartermission/contracts";
import { Panel } from "@chartermission/ui";
import { LoadError } from "@/components/account/load-error";
import { settle } from "@/components/account/settle";
import { RestrictedPrompt } from "@/components/account/verify-prompt";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { apiGet, requireViewer } from "@/lib/api/server";
import { getTaxonomies, groupCountries } from "@/lib/taxonomies";

export const metadata: Metadata = { title: "Set up your profile" };

function WizardSkeleton() {
  return (
    <div aria-hidden="true" className="mx-auto flex w-full max-w-[760px] flex-col gap-6 px-6 pt-8 pb-16 max-sm:px-4">
      <div className="flex flex-col gap-2">
        <span className="h-4 w-56 animate-pulse rounded bg-muted" />
        <span className="h-4 w-24 animate-pulse rounded bg-muted" />
        <span className="h-1.5 w-full animate-pulse rounded-full bg-muted" />
      </div>
      <Panel className="flex h-[560px] flex-col gap-4 p-6">
        <span className="h-8 w-2/3 animate-pulse rounded bg-muted" />
        <span className="h-5 w-4/5 animate-pulse rounded bg-muted" />
        <span className="mt-4 h-24 animate-pulse rounded-lg bg-muted" />
        <span className="h-16 animate-pulse rounded-lg bg-muted" />
      </Panel>
    </div>
  );
}

async function Wizard() {
  const viewer = await requireViewer("/onboarding");
  if (viewer.onboarding.completed) redirect("/feed");
  if (viewer.status === "suspended" || viewer.status === "deactivated") {
    return (
      <div className="mx-auto w-full max-w-[760px] px-6 pt-8">
        <RestrictedPrompt message="You can finish setting up your profile once your account is active again." />
      </div>
    );
  }
  const result = await settle(
    Promise.all([apiGet<OnboardingState>("/me/onboarding"), apiGet<OwnProfile>("/me/profile"), getTaxonomies()]),
  );
  if (!result.ok) {
    return (
      <div className="mx-auto w-full max-w-[760px] px-6 pt-8">
        <LoadError title="We couldn’t load your onboarding" message={result.error.message} />
      </div>
    );
  }
  const [state, profile, taxonomies] = result.data;
  if (state.completed) redirect("/feed");
  return (
    <OnboardingWizard
      initial={state}
      profile={{ organisation: profile.organisation, languages: profile.languages, avatarUrl: profile.avatarUrl }}
      taxonomies={taxonomies}
      countryGroups={groupCountries(taxonomies.countries)}
      viewer={{ name: viewer.name, tone: viewer.tone, emailVerified: viewer.emailVerified }}
    />
  );
}

/** Onboarding wizard — spec 4.2 CM-AUTH-07 (about, topics, skills, community). */
export default function OnboardingPage() {
  return (
    <main id="main" className="min-h-[calc(100dvh-64px)] bg-surface">
      <Suspense fallback={<WizardSkeleton />}>
        <Wizard />
      </Suspense>
    </main>
  );
}
