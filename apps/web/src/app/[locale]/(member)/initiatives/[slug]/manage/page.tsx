import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import type { InitiativeDetail, InitiativeJoinRequestView } from "@chartermission/contracts";
import { FormShell } from "@/components/events/form-page";
import { ManageInitiative } from "@/components/initiatives/manage-initiative";
import { initiativeHref } from "@/components/initiatives/format";
import { requireClientViewer } from "@/components/social/data";
import { PanelSkeleton } from "@/components/social/skeletons";
import { Toaster } from "@/components/social/toast";
import { apiGet, apiGetOrNull } from "@/lib/api/server";
import { getT } from "@/i18n/server";

type Props = PageProps<"/[locale]/initiatives/[slug]/manage">;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Manage initiative") };
}

async function Manage({ params }: Pick<Props, "params">) {
  const { slug } = await params;
  await requireClientViewer(`/initiatives/${slug}/manage`);
  const initiative = await apiGetOrNull<InitiativeDetail>(`/initiatives/${encodeURIComponent(slug)}`);
  if (!initiative) notFound();
  if (!initiative.viewer.canManage) redirect(initiativeHref(initiative.slug));
  const requests = await apiGet<InitiativeJoinRequestView[]>(`/initiatives/${initiative.id}/join-requests`);
  return <ManageInitiative initiative={initiative} requests={requests} />;
}

/** Organisers: answer join requests, run the team, delete the initiative. */
export default function ManageInitiativePage({ params }: Props) {
  return (
    <FormShell back={{ href: "/initiatives", label: "All initiatives" }} title="Manage initiative" description="Answer join requests and decide who organises it with you.">
      <Suspense fallback={<PanelSkeleton className="h-[480px]" lines={8} />}>
        <Manage params={params} />
      </Suspense>
      <Toaster />
    </FormShell>
  );
}
