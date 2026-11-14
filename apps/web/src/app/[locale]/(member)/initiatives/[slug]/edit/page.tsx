import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import type { InitiativeDetail } from "@chartermission/contracts";
import { FormShell } from "@/components/events/form-page";
import { InitiativeForm } from "@/components/initiatives/initiative-form";
import { initiativeHref } from "@/components/initiatives/format";
import { requireClientViewer } from "@/components/social/data";
import { PanelSkeleton } from "@/components/social/skeletons";
import { apiGetOrNull } from "@/lib/api/server";
import { initiativeOptions } from "../../options";
import { getT } from "@/i18n/server";

type Props = PageProps<"/[locale]/initiatives/[slug]/edit">;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Edit initiative") };
}

async function EditForm({ params }: Pick<Props, "params">) {
  const { slug } = await params;
  await requireClientViewer(`/initiatives/${slug}/edit`);
  const initiative = await apiGetOrNull<InitiativeDetail>(`/initiatives/${encodeURIComponent(slug)}`);
  if (!initiative) notFound();
  if (!initiative.viewer.canManage) redirect(initiativeHref(initiative.slug));
  const options = await initiativeOptions();
  return <InitiativeForm initiative={initiative} themes={options.themes} countries={options.countries} />;
}

export default function EditInitiativePage({ params }: Props) {
  return (
    <FormShell back={{ href: "/initiatives", label: "All initiatives" }} title="Edit initiative" description="Changes show straight away. Ticking off a milestone moves the progress bar on the card.">
      <Suspense fallback={<PanelSkeleton className="h-[640px]" lines={10} />}>
        <EditForm params={params} />
      </Suspense>
    </FormShell>
  );
}
