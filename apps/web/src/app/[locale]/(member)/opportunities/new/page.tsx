import type { Metadata } from "next";
import { Suspense } from "react";
import { FormShell } from "@/components/events/form-page";
import { OpportunityForm } from "@/components/opportunities/opportunity-form";
import { requireClientViewer } from "@/components/social/data";
import { VerifyEmailPrompt } from "@/components/social/errors";
import { PanelSkeleton } from "@/components/social/skeletons";
import { formOptions } from "../form-data";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Post an opportunity") };
}

async function NewForm() {
  const viewer = await requireClientViewer("/opportunities/new");
  if (!viewer.emailVerified) return <VerifyEmailPrompt message="Verify your email address to post opportunities." />;
  const options = await formOptions();
  return <OpportunityForm countries={options.countries} sectors={options.sectors} />;
}

export default function NewOpportunityPage() {
  return (
    <FormShell
      back={{ href: "/opportunities", label: "All opportunities" }}
      title="Post an opportunity"
      description="A job, fellowship, grant or call for partners. It goes live as soon as you publish, and members apply here with their profile."
    >
      <Suspense fallback={<PanelSkeleton className="h-[640px]" lines={10} />}>
        <NewForm />
      </Suspense>
    </FormShell>
  );
}
