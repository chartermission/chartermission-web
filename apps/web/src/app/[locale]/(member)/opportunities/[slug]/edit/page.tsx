import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import type { OpportunityDetail } from "@chartermission/contracts";
import { FormShell } from "@/components/events/form-page";
import { OpportunityForm } from "@/components/opportunities/opportunity-form";
import { requireClientViewer } from "@/components/social/data";
import { PanelSkeleton } from "@/components/social/skeletons";
import { apiGetOrNull } from "@/lib/api/server";
import { formOptions } from "../../form-data";

export const metadata: Metadata = { title: "Edit opportunity" };

async function EditForm({ params }: Pick<PageProps<"/[locale]/opportunities/[slug]/edit">, "params">) {
  const { slug } = await params;
  await requireClientViewer(`/opportunities/${slug}/edit`);
  const [o, options] = await Promise.all([apiGetOrNull<OpportunityDetail>(`/opportunities/${encodeURIComponent(slug)}`), formOptions()]);
  if (!o) notFound();
  if (!o.viewer.canManage) redirect(`/opportunities/${o.slug}`);
  return <OpportunityForm opportunity={o} countries={options.countries} sectors={options.sectors} />;
}

export default function EditOpportunityPage({ params }: PageProps<"/[locale]/opportunities/[slug]/edit">) {
  return (
    <FormShell back={{ href: "/opportunities/mine", label: "My opportunities" }} title="Edit opportunity" description="Changes show to members straight away.">
      <Suspense fallback={<PanelSkeleton className="h-[640px]" lines={10} />}>
        <EditForm params={params} />
      </Suspense>
    </FormShell>
  );
}
