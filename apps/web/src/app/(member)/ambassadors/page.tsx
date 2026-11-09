import type { Metadata } from "next";
import { Suspense } from "react";
import type { MyAmbassadorView } from "@chartermission/contracts";
import { LoadError } from "@/components/account/load-error";
import { settle } from "@/components/account/settle";
import { AmbassadorProgramme } from "@/components/ambassadors/programme";
import { PageHeader, PageShell } from "@/components/discover/page-shell";
import { PanelSkeleton } from "@/components/social/skeletons";
import { apiGet, requireViewer } from "@/lib/api/server";
import { getTaxonomies, groupCountries } from "@/lib/taxonomies";

export const metadata: Metadata = {
  title: "Ambassador programme",
  description: "Lead your country's Charter Mission chapter as an Ambassador, or nominate someone who would.",
};

async function Programme() {
  const viewer = await requireViewer("/ambassadors");
  const [view, taxonomies] = await Promise.all([settle(apiGet<MyAmbassadorView>("/ambassadors/me")), settle(getTaxonomies())]);
  if (!view.ok) return <LoadError title="We couldn’t load the Ambassador programme" message={view.error.message} retryHref="/ambassadors" />;
  if (!taxonomies.ok) return <LoadError title="We couldn’t load the country list" message={taxonomies.error.message} retryHref="/ambassadors" />;
  return (
    <AmbassadorProgramme
      initial={view.data}
      countryGroups={groupCountries(taxonomies.data.countries)}
      emailVerified={viewer.emailVerified}
      defaultCountry={viewer.countryCode}
      name={viewer.name}
    />
  );
}

/** Ambassador programme: apply, follow an application, onboard (agreement, checklist) and nominate. */
export default function AmbassadorsPage() {
  return (
    <PageShell>
      <PageHeader
        title="Ambassador programme"
        description="Ambassadors lead their country’s chapter: welcoming members, hosting events and representing the community."
      />
      <Suspense
        fallback={
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
            <PanelSkeleton className="h-[420px]" lines={6} />
            <PanelSkeleton className="h-[320px]" lines={4} />
          </div>
        }
      >
        <Programme />
      </Suspense>
    </PageShell>
  );
}
