import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import type { PagesSettings } from "@chartermission/contracts";
import { Icon, Panel } from "@chartermission/ui";
import { PageForm } from "@/components/pages/page-form";
import { LoadingStatus, PanelSkeleton } from "@/components/social/skeletons";
import { Toaster } from "@/components/social/toast";
import { apiGet, requireViewer } from "@/lib/api/server";
import { getTaxonomies, groupCountries } from "@/lib/taxonomies";

export const metadata: Metadata = { title: "Create a page" };

async function NewPage() {
  const viewer = await requireViewer("/pages/new");
  const [settings, taxonomies] = await Promise.all([apiGet<PagesSettings>("/pages/settings"), getTaxonomies()]);
  const staff = viewer.permissions.includes("pages.manage");
  if (settings.memberCreation === "closed" && !staff) {
    return (
      <Panel className="flex flex-col items-start gap-3 p-6">
        <h1 className="text-h2 text-ink">Pages are created by the Charter Mission team</h1>
        <p className="text-md text-body">To get a page for your organisation, message the team or email hello@chartermission.com with its name and website.</p>
        <Link href="/pages" className="text-sm font-medium text-primary-light hover:underline">
          Back to pages
        </Link>
      </Panel>
    );
  }
  if (!viewer.emailVerified) {
    return (
      <Panel className="flex flex-col items-start gap-3 p-6">
        <h1 className="text-h2 text-ink">Verify your email first</h1>
        <p className="text-md text-body">Confirm your email address, then come back to create a page.</p>
      </Panel>
    );
  }
  return (
    <Panel className="flex flex-col gap-5 p-6 max-sm:p-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-h2 text-ink">Create a page</h1>
        <p className="text-md text-secondary">
          A page is the home of an organisation, company or initiative on Charter Mission. You’ll be its owner and can add other admins afterwards.
        </p>
      </div>
      <PageForm countries={groupCountries(taxonomies.countries)} policy={staff ? "open" : settings.memberCreation} />
    </Panel>
  );
}

export default function NewPagePage() {
  return (
    <main id="main" className="mx-auto flex w-full max-w-[760px] flex-col gap-4 px-6 pb-12 pt-6 max-sm:px-3 max-sm:pt-4">
      <Link href="/pages" className="flex w-fit items-center gap-1.5 rounded-sm text-sm font-medium text-primary-light hover:underline">
        <Icon name="chevron-left" size={18} />
        Pages
      </Link>
      <Suspense
        fallback={
          <>
            <LoadingStatus label="Loading the form" />
            <PanelSkeleton className="h-[560px]" lines={8} />
          </>
        }
      >
        <NewPage />
      </Suspense>
      <Toaster />
    </main>
  );
}
