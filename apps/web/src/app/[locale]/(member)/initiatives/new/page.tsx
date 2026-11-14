import type { Metadata } from "next";
import { Suspense } from "react";
import type { InitiativeHostOptions } from "@chartermission/contracts";
import { FormShell } from "@/components/events/form-page";
import { InitiativeForm } from "@/components/initiatives/initiative-form";
import { requireClientViewer, settle } from "@/components/social/data";
import { VerifyEmailPrompt } from "@/components/social/errors";
import { PanelSkeleton } from "@/components/social/skeletons";
import { apiGet } from "@/lib/api/server";
import { initiativeOptions } from "../options";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Start an initiative") };
}

async function NewForm() {
  const viewer = await requireClientViewer("/initiatives/new");
  if (!viewer.emailVerified) return <VerifyEmailPrompt message="Verify your email address to start an initiative." />;
  const [options, hosts] = await Promise.all([initiativeOptions(), settle(apiGet<InitiativeHostOptions>("/initiatives/host-options"))]);
  return <InitiativeForm hosts={hosts.ok ? hosts.data : undefined} themes={options.themes} countries={options.countries} />;
}

export default function NewInitiativePage() {
  return (
    <FormShell
      back={{ href: "/initiatives", label: "All initiatives" }}
      title="Start an initiative"
      description="A project you’re running, by yourself, for a page you manage or for a chapter you lead. Members can ask to join, follow it and read your updates."
    >
      <Suspense fallback={<PanelSkeleton className="h-[640px]" lines={10} />}>
        <NewForm />
      </Suspense>
    </FormShell>
  );
}
